import { test, expect, signIn } from './fixtures.mjs';
import { createToken } from '../../server/auth.js';

for (const sender of ['seeker', 'owner']) {
  test(`${sender} can invite from discovery after a decline`, async ({ page, context, environment }) => {
    const owner = await context.newPage();
    const parties = { seeker: page, owner };
    const recipient = sender === 'seeker' ? 'owner' : 'seeker';
    const ids = {};
    const tokens = {};
    for (const actor of Object.keys(parties)) {
      const { user_id: id } = await environment.db.prepare(`INSERT INTO USER(first_name,last_name,email,profile_reminder_seen_at)
        VALUES (?,?,?,CURRENT_TIMESTAMP) RETURNING user_id`).get(actor, `Reinvite ${sender}`, `${sender}-${actor}@reinvite.test`);
      ids[actor] = id;
      tokens[actor] = createToken(id);
    }
    const initial = await page.request.post('/api/friends/connections', {
      headers: { Authorization: `Bearer ${tokens.seeker}` },
      data: { recipientId: ids.owner },
    });
    expect(initial.status()).toBe(201);
    const { connection: original } = await initial.json();
    const read = async actor => {
      const result = await page.request.get('/api/friends/connections', {
        headers: { Authorization: `Bearer ${tokens[actor]}` },
      });
      expect(result.ok()).toBeTruthy();
      return (await result.json()).connections;
    };
    const button = (scope, name) => scope.getByRole('button', { name, exact: true });
    await signIn(owner, { tokens }, 'owner');
    await signIn(page, { tokens }, 'seeker');
    await owner.goto('/friends?view=invitations&invitations=incoming');
    await button(owner, 'ปฏิเสธ').click();
    await expect.poll(async () => (await read('owner'))[0].status).toBe('declined');

    const cards = {};
    for (const [actor, tab] of Object.entries(parties)) {
      await tab.goto('/friends?view=invitations&invitations=history');
      await tab.reload();
      const label = actor === 'owner' ? 'คุณปฏิเสธคำชวน' : 'คำชวนไม่ได้รับการตอบรับ';
      await expect(tab.getByText(label, { exact: true })).toBeVisible();
      await expect(button(tab, 'ส่งคำชวนใหม่')).toHaveCount(0);
      const [{ person }] = await read(actor);
      const name = `${person.firstName} ${person.lastName}`;
      cards[actor] = tab.locator('.friend-card').filter({ has: tab.getByRole('heading', { name, exact: true }) });
      await tab.goto('/friends?q=impossible-friend-match');
      await expect(tab.getByText('ไม่พบเพื่อนที่ตรงกับคำค้น')).toBeVisible();
      await tab.getByRole('textbox', { name: 'ค้นหาเพื่อน' }).fill(person.firstName);
      await expect(button(cards[actor], 'ส่งคำชวนเป็นเพื่อน')).toBeVisible();
    }

    const sendingTab = parties[sender];
    await button(cards[sender], 'ส่งคำชวนเป็นเพื่อน').click();
    const confirm = sendingTab.getByRole('dialog', { name: 'ยืนยันส่งคำชวนเป็นเพื่อน' });
    await button(confirm, 'ยกเลิก').click();
    expect((await read(sender)).map(item => item.status)).toEqual(['declined']);

    await button(cards[sender], 'ส่งคำชวนเป็นเพื่อน').click();
    await button(confirm, 'ยืนยันส่งคำชวน').evaluate(element => { element.click(); element.click(); });
    await expect(cards[sender]).toContainText('ส่งคำชวนแล้ว · รอตอบรับ');
    const [pending, declined] = await read(sender);
    expect(pending).toMatchObject({ status: 'pending', direction: 'outgoing' });
    expect(pending.connectionId).not.toBe(original.connectionId);
    expect(declined).toMatchObject({ connectionId: original.connectionId, status: 'declined', direction: sender === 'owner' ? 'incoming' : 'outgoing' });

    const receivingTab = parties[recipient];
    // The other tab was already open before this invitation and still has a stale card.
    await button(cards[recipient], 'ส่งคำชวนเป็นเพื่อน').click();
    await button(receivingTab.getByRole('dialog'), 'ยืนยันส่งคำชวน').click();
    await expect(receivingTab.getByRole('alert')).toContainText('มีคำชวนอยู่แล้ว');
    await expect(button(cards[recipient], 'ส่งคำชวนเป็นเพื่อน')).toHaveCount(0);
    expect((await read(recipient)).filter(item => item.status === 'pending')).toEqual([
      expect.objectContaining({ connectionId: pending.connectionId, direction: 'incoming' }),
    ]);
    await receivingTab.getByRole('button', { name: /^คำชวน/ }).click();
    await button(cards[recipient], 'ตอบรับคำชวน').click();
    await expect.poll(async () => (await read(recipient))[0].status).toBe('accepted');

    for (const [actor, tab] of Object.entries(parties)) {
      await tab.goto('/friends?view=friends');
      await expect(cards[actor]).toBeVisible();
      await expect(button(cards[actor], 'ส่งคำชวนเป็นเพื่อน')).toHaveCount(0);
      expect((await read(actor)).map(item => [item.connectionId, item.status])).toEqual([
        [pending.connectionId, 'accepted'], [original.connectionId, 'declined'],
      ]);
    }
    await owner.close();
  });
}


test('a withdrawn friendship invitation can be resent from history', async ({ page, environment }) => {
  await signIn(page, environment, 'owner');
  await page.goto('/friends?view=invitations&invitations=outgoing');
  await page.getByRole('button', { name: 'ถอนคำชวน', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: /ยืนยันถอน/ }).click();
  await expect(page.getByText('คุณถอนคำชวนแล้ว', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'ส่งคำชวนใหม่' }).click();
  await page.getByRole('button', { name: 'ยืนยันส่งคำชวน', exact: true }).click();
  await expect(page.getByText('ส่งคำชวนใหม่แล้ว ดูสถานะได้ที่รอเพื่อนตอบ')).toBeVisible();
  await expect(page.getByText('คุณถอนคำชวนแล้ว', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ส่งคำชวนใหม่' })).toHaveCount(0);
  await page.getByRole('button', { name: /รอเพื่อนตอบ/ }).click();
  await expect(page.getByRole('button', { name: 'ถอนคำชวน', exact: true })).toBeVisible();
});
