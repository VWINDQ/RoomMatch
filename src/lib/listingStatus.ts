import type { Room } from '../types';

export function createListingStatusActions(callbacks: {
  update: (roomId: string, payload: { status: Room['status'] }) => Promise<Room>;
  onPending: (roomIds: Set<string>) => void;
  onUpdated: (room: Room) => void;
  onError: (message: string) => void;
}) {
  const pending = new Set<string>();
  return {
    isPending: (roomId: string) => pending.has(roomId),
    async toggle(room: Room) {
      // This guard runs synchronously, before React can render disabled buttons.
      if (pending.has(room.roomId)) return;
      pending.add(room.roomId);
      callbacks.onPending(new Set(pending));
      try {
        const updated = await callbacks.update(room.roomId, { status: room.status === 'inactive' ? 'available' : 'inactive' });
        callbacks.onUpdated(updated);
      } catch (caught) {
        callbacks.onError(caught instanceof Error ? caught.message : 'อัปเดตสถานะไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
      } finally {
        pending.delete(room.roomId);
        callbacks.onPending(new Set(pending));
      }
    },
  };
}
