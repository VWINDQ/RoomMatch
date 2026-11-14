import { ArrowLeft, ArrowRight, ImagePlus, Trash2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../lib/api';
import './ImagePicker.css';

export type SelectedImage = { id: string; url: string; file?: File };
export const savedImages = (urls: string[]): SelectedImage[] => urls.filter(Boolean).map(url => ({ id: crypto.randomUUID(), url }));

// Keep completed uploads in form state if a later upload or save fails.
// Retrying then sends only files that have not already been uploaded.
export async function uploadSelectedImages(images: SelectedImage[], onUploaded: (image: SelectedImage) => void) {
  const urls: string[] = [];
  for (const image of images) {
    const url = image.file ? await api.uploadImage(image.file) : image.url;
    if (image.file) onUploaded({ id: image.id, url });
    urls.push(url);
  }
  return urls;
}

function ImagePreview({ image, label }: { image: SelectedImage; label: string }) {
  const [src, setSrc] = useState(image.url);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const url = image.file ? URL.createObjectURL(image.file) : image.url;
    setSrc(url); setFailed(false);
    return () => { if (image.file) URL.revokeObjectURL(url); };
  }, [image.file, image.url]);
  return failed ? <span className="image-picker-unavailable">เปิดภาพตัวอย่างไม่ได้</span> : src ? <img src={src} alt={label} onError={() => setFailed(true)}/> : null;
}

export function ImagePicker({ images, onChange, max = 1, disabled = false, label, error }: {
  images: SelectedImage[]; onChange: (images: SelectedImage[]) => void; max?: number; disabled?: boolean; label: string; error?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const descriptionId = useId();
  const [selectionError, setSelectionError] = useState('');
  const message = selectionError || error;
  const move = (index: number, direction: number) => {
    const next = [...images];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    onChange(next);
  };
  return <div className={`image-picker ${max === 1 ? 'image-picker-single' : ''}`} role="group" aria-label={label}>
    <div className="image-picker-heading"><strong>{label}</strong><span>{images.length}/{max} รูป</span></div>
    <p className="image-picker-hint" id={descriptionId}>JPG, PNG หรือ WebP ไม่เกิน 5 MB ต่อรูป{max > 1 ? ' · รูปแรกใช้เป็นรูปปก' : ''}<br/>รูปจะอัปโหลดเมื่อกดบันทึก</p>
    {images.length > 0 && <ul className="image-picker-grid">{images.map((image, index) => <li key={image.id}>
      <div className="image-picker-preview"><ImagePreview image={image} label={max === 1 ? 'รูปโปรไฟล์ที่เลือก' : `รูปห้อง ${index + 1}`}/>{max > 1 && index === 0 && <span className="image-picker-cover">รูปปก</span>}</div>
      <div className="image-picker-tools">{max > 1 && <><button type="button" disabled={disabled || index === 0} onClick={() => move(index, -1)} aria-label={`เลื่อนรูป ${index + 1} ไปก่อนหน้า`}><ArrowLeft size={16}/></button><button type="button" disabled={disabled || index === images.length - 1} onClick={() => move(index, 1)} aria-label={`เลื่อนรูป ${index + 1} ไปถัดไป`}><ArrowRight size={16}/></button></>}<button type="button" disabled={disabled} onClick={() => { onChange(images.filter(item => item.id !== image.id)); setSelectionError(''); }} aria-label={max === 1 ? 'ลบรูปโปรไฟล์' : `ลบรูป ${index + 1}`}><Trash2 size={16}/><span>ลบรูป</span></button></div>
    </li>)}</ul>}
    <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple={max > 1} disabled={disabled} hidden aria-label={label} onChange={event => {
      const files = Array.from(event.currentTarget.files || []);
      event.currentTarget.value = '';
      if (!files.length) return;
      if ((max === 1 ? files.length : images.length + files.length) > max) { setSelectionError(`เลือกได้ไม่เกิน ${max} รูป`); return; }
      if (files.some(file => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) { setSelectionError('รองรับเฉพาะรูป JPG, PNG และ WebP'); return; }
      if (files.some(file => file.size > 5 * 1024 * 1024 || file.size === 0)) { setSelectionError('กรุณาเลือกรูปที่มีขนาดมากกว่า 0 และไม่เกิน 5 MB'); return; }
      const selected = files.map(file => ({ id: crypto.randomUUID(), url: '', file }));
      onChange(max === 1 ? selected : [...images, ...selected]); setSelectionError('');
    }}/>
    {(max === 1 || images.length < max) && <button type="button" className="image-picker-add" disabled={disabled} aria-describedby={descriptionId} onClick={() => inputRef.current?.click()}><ImagePlus size={20}/>{images.length && max === 1 ? 'เปลี่ยนรูปจากเครื่อง' : 'เลือกรูปจากเครื่อง'}</button>}
    {message && <p className="field-error" role="alert">{message}</p>}
  </div>;
}
