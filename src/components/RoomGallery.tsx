import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ImageOff } from 'lucide-react';
import type { Room } from '../types';
import { RoomPhoto } from './RoomPhoto';

export function RoomGallery({ room }: { room: Room }) {
  const [active, setActive] = useState(0); const count = room.images.length;
  const thumbnails = useRef<HTMLDivElement>(null);
  const activeIndex = Math.min(active, Math.max(0, count - 1));
  useEffect(() => setActive(0), [room.roomId]);
  useEffect(() => {
    const strip = thumbnails.current;
    const selected = strip?.children[activeIndex] as HTMLElement | undefined;
    if (!strip || !selected) return;
    // Scroll only the thumbnail strip; changing photos must not move the page.
    if (selected.offsetTop < strip.scrollTop) strip.scrollTop = selected.offsetTop;
    else if (selected.offsetTop + selected.offsetHeight > strip.scrollTop + strip.clientHeight) {
      strip.scrollTop = selected.offsetTop + selected.offsetHeight - strip.clientHeight;
    }
  }, [activeIndex, count, room.roomId]);
  if (!count) return <section className="gallery gallery-empty"><ImageOff/><p>ประกาศนี้ยังไม่มีรูปภาพ</p></section>;
  const move = (direction: number) => setActive((activeIndex + direction + count) % count);
  return <section className={`gallery ${count === 1 ? 'gallery-single' : ''}`} aria-label="รูปภาพห้อง"><div className="gallery-main"><RoomPhoto src={room.images[activeIndex].imageUrl} alt={`${room.title} รูปที่ ${activeIndex + 1}`} priority/>
    {count > 1 && <><button className="gallery-control previous" onClick={() => move(-1)} aria-label="รูปก่อนหน้า"><ChevronLeft/></button><button className="gallery-control next" onClick={() => move(1)} aria-label="รูปถัดไป"><ChevronRight/></button></>}<span>{activeIndex + 1} / {count}</span></div>
    {count > 1 && <div className="gallery-thumbs"><div className="gallery-thumbs-scroll" ref={thumbnails}>{room.images.map((image, index) => <button key={image.imageId} className={activeIndex === index ? 'active' : ''} onClick={() => setActive(index)} aria-pressed={activeIndex === index} aria-label={`ดูรูปที่ ${index + 1}`}><RoomPhoto src={image.imageUrl} alt=""/></button>)}</div></div>}
  </section>;
}
