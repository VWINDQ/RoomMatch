import { ArrowLeft, ArrowRight, ImagePlus, Trash2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../lib/api';
import { completedListingImageUrls } from '../../shared/listingValidation.js';
import { IMAGE_ACCEPT } from '../../shared/imageUpload.js';
import { selectImageFiles } from '../lib/imageSelection';
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

export function ImagePicker({ images, onChange, max = 1, disabled = false, label, error, required = false, fieldName, onCheckingChange, onSelectionCancel }: {
  images: SelectedImage[]; onChange: (images: SelectedImage[]) => void; max?: number; disabled?: boolean; label: string; error?: string; required?: boolean; fieldName?: string; onCheckingChange?: (checking: boolean) => void; onSelectionCancel?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const input = inputRef.current;
    if (!input || !onSelectionCancel) return;
    input.addEventListener('cancel', onSelectionCancel);
    return () => input.removeEventListener('cancel', onSelectionCancel);
  }, [onSelectionCancel]);
  const descriptionId = useId();
  const errorId = useId();
  const [selectionError, setSelectionError] = useState('');
  const [checking, setChecking] = useState(false);
  const checkingRef = useRef(false);
  const selectionVersion = useRef(0);
  useEffect(() => () => {
    // Ignore a file read that finishes after cancelling or leaving the form.
    selectionVersion.current += 1;
    onCheckingChange?.(false);
  }, [onCheckingChange]);
  const busy = disabled || checking;
  const chooseFiles = async (files: File[]) => {
    if (disabled || checkingRef.current || !files.length) return;
    const version = selectionVersion.current;
    checkingRef.current = true; setChecking(true); onCheckingChange?.(true);
    try {
      const result = await selectImageFiles(files, max === 1 ? 1 : max - images.length);
      if (version !== selectionVersion.current) return;
      if (result.accepted.length) {
        const selected = result.accepted.map(file => ({ id: crypto.randomUUID(), url: '', file }));
        onChange(max === 1 ? selected : [...images, ...selected]);
      }
      setSelectionError(result.rejected.join(' · '));
    } finally {
      checkingRef.current = false;
      if (version === selectionVersion.current) { setChecking(false); onCheckingChange?.(false); }
    }
  };
  const message = selectionError || error;
  const imageCount = required ? completedListingImageUrls(images).length : images.length;
  const move = (index: number, direction: number) => {
    const next = [...images];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    onChange(next);
  };
  return <div className={`image-picker ${max === 1 ? 'image-picker-single' : ''}`} role="group" tabIndex={fieldName ? -1 : undefined} data-error-field={fieldName} aria-busy={checking} aria-label={label} aria-required={required || undefined} aria-invalid={message ? true : undefined} aria-describedby={message ? `${descriptionId} ${errorId}` : descriptionId}
    onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); event.stopPropagation(); void chooseFiles(Array.from(event.dataTransfer.files)); }}>
    <div className="image-picker-heading"><strong>{label}{required && <> <span className="required-marker" aria-hidden="true">*</span></>}</strong><span>{imageCount}/{max} รูป</span></div>
    <p className="image-picker-hint" id={descriptionId}>JPG, PNG หรือ WebP ไม่เกิน 5 MB ต่อรูป{max > 1 ? ' · รูปแรกใช้เป็นรูปปก' : ''}<br/>รูปจะอัปโหลดเมื่อกดบันทึก</p>
    {images.length > 0 && <ul className="image-picker-grid">{images.map((image, index) => <li key={image.id}>
      <div className="image-picker-preview"><ImagePreview image={image} label={max === 1 ? 'รูปโปรไฟล์ที่เลือก' : `รูปห้อง ${index + 1}`}/>{max > 1 && index === 0 && <span className="image-picker-cover">รูปปก</span>}</div>
      <div className="image-picker-tools">{max > 1 && <><button type="button" disabled={busy || index === 0} onClick={() => move(index, -1)} aria-label={`เลื่อนรูป ${index + 1} ไปก่อนหน้า`}><ArrowLeft size={16}/></button><button type="button" disabled={busy || index === images.length - 1} onClick={() => move(index, 1)} aria-label={`เลื่อนรูป ${index + 1} ไปถัดไป`}><ArrowRight size={16}/></button></>}<button type="button" disabled={busy} onClick={() => { onChange(images.filter(item => item.id !== image.id)); setSelectionError(''); }} aria-label={max === 1 ? 'ลบรูปโปรไฟล์' : `ลบรูป ${index + 1}`}><Trash2 size={16}/><span>ลบรูป</span></button></div>
    </li>)}</ul>}
    {checking && <p role="status" className="image-picker-hint">กำลังตรวจไฟล์ภาพ…</p>}
    <input ref={inputRef} type="file" accept={IMAGE_ACCEPT} multiple={max > 1} disabled={busy} hidden aria-label={label} onChange={event => {
      const files = Array.from(event.currentTarget.files || []);
      event.currentTarget.value = '';
      if (!files.length) { onSelectionCancel?.(); return; }
      void chooseFiles(files);
    }}/>
    {(max === 1 || images.length < max) && <button type="button" className="image-picker-add" disabled={busy} aria-describedby={descriptionId} onClick={() => inputRef.current?.click()}><ImagePlus size={20}/>{images.length && max === 1 ? 'เปลี่ยนรูปจากเครื่อง' : 'เลือกรูปจากเครื่อง'}</button>}
    {message && <p id={errorId} className="field-error" role="alert">{message}</p>}
  </div>;
}
