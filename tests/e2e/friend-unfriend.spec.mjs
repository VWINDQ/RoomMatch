import { test, expect, signIn, noOverflow } from './fixtures.mjs';
import { createToken } from '../../server/auth.js';

for (const actor of ['a', 'b']) {
  test(`${actor} can unfriend, revoke contact access, and become friends again`, async ({ page, context, environment }) => {
    const other = await context.newPage();
    const tabs = { a: page, b: other };
    const ids = {};
    const tokens = {};
    for (const name of Object.keys(tabs)) {
      const { user_id: id } = await environment.db.prepare(`INSERT INTO USER
        (first_name,last_name,email,line_id,instagram,profile_reminder_seen_at)
        VALUES (?,?,?,?,?,CURRENT_TIMESTAMP) RETURNING user_id`)
        .get(name, `Unfriend ${actor}`, `${name}-${actor}@unfriend.test`, `line-${name}`, `ig-${name}`);
      ids[name] = id;
      tokens[name] = createToken(id);
      await signIn(tabs[name], { tokens }, name);
    }
    const auth = name => ({ Authorization: `Bearer ${tokens[name]}` });
    const endpoint = '/api/friends/connections';
    const invited = await page.request.post(endpoint, { headers: auth('a'), data: { recipientId: ids.b } });
    expect(invited.status()).toBe(201);
    const { connection: original } = await invited.json();
    const accept = await page.request.patch(`${endpoint}/${original.connectionId}`, { headers: auth('b'), data: { status: 'accepted' } });
    expect(accept.ok()).toBeTruthy();

    const button = (scope, name) => scope.getByRole('button', { name, exact: true });
    const removing = tabs[actor];
    const recipient = actor === 'a' ? 'b' : 'a';
    const remaining = tabs[recipient];
    for (const tab of Object.values(tabs)) {
      await tab.goto('/friends?view=friends');
      await expect(button(tab, 'เลิกเป็นเพื่อน')).toBeVisible();
    }
    const launch = button(removing, 'เลิกเป็นเพื่อน');
    const dialog = removing.getByRole('dialog', { name: 'ยืนยันเลิกเป็นเพื่อน' });
    let submissions = 0;
    const path = `${endpoint}/${original.connectionId}/unfriend`;
    removing.on('request', request => { if (new URL(request.url()).pathname === path) submissions++; });
    for (const dismissal of ['ยกเลิก', 'ปิด', 'Escape']) {
      await launch.click();
      await expect(dialog).toContainText(`${recipient} Unfriend ${actor}`);
      await noOverflow(removing);
      if (dismissal === 'Escape') await removing.keyboard.press('Escape');
      else await button(dialog, dismissal).click();
      await expect(dialog).toHaveCount(0);
      await expect(launch).toBeFocused();
    }
    expect(submissions).toBe(0);
    for (const tab of Object.values(tabs)) {
      await button(tab, 'ดูโปรไฟล์').click();
      await expect(tab.getByRole('dialog').locator('.contact-actions-line')).toBeVisible();
      await expect(tab.getByRole('dialog').locator('.contact-actions-instagram')).toBeVisible();
      if (tab === removing) await tab.keyboard.press('Escape');
    }

    await removing.route(`**${path}`, route => route.fulfill({ status: 500, json: { error: 'Try again' } }), { times: 1 });
    await launch.click();
    const confirm = button(dialog, 'ยืนยันเลิกเป็นเพื่อน');
    await confirm.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(confirm).toBeEnabled();
    await confirm.evaluate(element => { element.click(); element.click(); });
    await expect(dialog).toHaveCount(0);
    await expect(launch).toHaveCount(0);
    expect(submissions).toBe(2);
    await remaining.reload();
    await expect(remaining.getByRole('heading', { name: 'ยังไม่มีเพื่อนที่ตอบรับ' })).toBeVisible();

    const cards = {};
    for (const [name, tab] of Object.entries(tabs)) {
      const counterpart = name === 'a' ? 'b' : 'a';
      await tab.goto(`/friends?q=${encodeURIComponent(counterpart + ' Unfriend ' + actor)}`);
      const card = tab.locator('.friend-card');
      cards[name] = card;
      await expect(card).toHaveCount(1);
      await button(card, 'ดูโปรไฟล์').click();
      const profile = tab.getByRole('dialog');
      await expect(profile.locator('.contact-actions')).toHaveCount(0);
      await tab.keyboard.press('Escape');
      await expect(button(card, 'ส่งคำชวนเป็นเพื่อน')).toBeVisible();
    }
    await button(cards[actor], 'ส่งคำชวนเป็นเพื่อน').click();
    await button(removing.getByRole('dialog'), 'ยืนยันส่งคำชวน').click();
    await expect(cards[actor]).toContainText('ส่งคำชวนแล้ว · รอตอบรับ');
    await remaining.goto('/friends?view=invitations&invitations=incoming');
    await button(remaining, 'ตอบรับคำชวน').click();
    await expect(remaining).toHaveURL(/view=friends/);
    for (const [name, tab] of Object.entries(tabs)) {
      await tab.goto('/friends?view=friends');
      await button(tab, 'ดูโปรไฟล์').click();
      await expect(tab.getByRole('dialog').locator('.contact-actions-line')).toBeVisible();
      await expect(tab.getByRole('dialog').locator('.contact-actions-instagram')).toBeVisible();
      const { connections } = await (await tab.request.get(endpoint, { headers: auth(name) })).json();
      expect(connections).toHaveLength(2);
      expect(connections[0]).toMatchObject({ status: 'accepted' });
      expect(connections[0].connectionId).not.toBe(original.connectionId);
      expect(connections[1]).toMatchObject({ status: 'unfriended', connectionId: original.connectionId });
    }
    await other.close();
  });
}
