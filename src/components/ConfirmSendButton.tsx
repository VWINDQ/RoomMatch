import { useRef, useState, type ComponentProps } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../AppContext';
import { ContactDisclosure, friendContactDisclosure } from './ContactDisclosure';
import { Button, Modal } from './UI';

type Props = Omit<ComponentProps<typeof Button>, 'onClick'> & {
  onConfirm: () => Promise<unknown>;
  roomMessage?: string;
};

export function ConfirmSendButton({ onConfirm, roomMessage, ...buttonProps }: Props) {
  const { user } = useApp();
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const locked = useRef(false);
  const close = () => { if (!locked.current) setOpen(false); };

  async function confirm() {
    if (locked.current || buttonProps.disabled) return;
    locked.current = true;
    setSending(true);
    try {
      await onConfirm();
    } finally {
      locked.current = false;
      setSending(false);
      setOpen(false);
    }
  }

  return <>
    <Button {...buttonProps} onClick={() => setOpen(true)}/>
    {open && createPortal(<Modal
      className="confirmation-modal"
      title={roomMessage ? 'ยืนยันขอเข้าพัก' : 'ยืนยันส่งคำชวนเป็นเพื่อน'}
      onClose={close}
      actions={<>
        <Button variant="quiet" disabled={sending} onClick={close}>ยกเลิก</Button>
        <Button loading={sending} disabled={buttonProps.disabled} onClick={confirm}>{roomMessage ? 'ยืนยันส่งคำขอ' : 'ยืนยันส่งคำชวน'}</Button>
      </>}
    ><ContactDisclosure lines={[roomMessage || friendContactDisclosure(user)]}/></Modal>, document.body)}
  </>;
}
