import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ImageOff } from 'lucide-react';
import type { Room } from '../types';
import { RoomPhoto } from './RoomPhoto';

export function RoomGallery({ room }: { room: Room }) {
  const [active, setActive] = useState(0); const count = room.images.length;
  useEffect(() => setActive(0), [room.roomId]);
  if (!count) return <section className="gallery gallery-empty"><ImageOff/><p>ประกาศนี้ยังไม่มีรูปภาพ</p></section>;
  const move = (direction: number) => setActive(current => (current + direction + count) % count);
  return <section className={`gallery ${count === 1 ? 'gallery-single' : ''}`} aria-label="รูปภาพห้อง"><div className="gallery-main"><RoomPhoto src={room.images[active].imageUrl} alt={`${room.title} รูปที่ ${active + 1}`}/>
    {count > 1 && <><button className="gallery-control previous" onClick={() => move(-1)} aria-label="รูปก่อนหน้า"><ChevronLeft/></button><button className="gallery-control next" onClick={() => move(1)} aria-label="รูปถัดไป"><ChevronRight/></button></>}<span>{active + 1} / {count}</span></div>
    {count > 1 && <div className="gallery-thumbs">{room.images.map((image, index) => <button key={image.imageId} className={active === index ? 'active' : ''} onClick={() => setActive(index)} aria-label={`ดูรูปที่ ${index + 1}`}><RoomPhoto src={image.imageUrl} alt=""/></button>)}</div>}
  </section>;
}
