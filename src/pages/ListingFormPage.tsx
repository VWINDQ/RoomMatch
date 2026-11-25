import { Skeleton } from '../components/Skeleton';
import { ArrowLeft, MapPin, UsersRound } from 'lucide-react';
import { useEffect, useRef, useState, type FocusEvent, type FormEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../AppContext';
import { Button, Input, Modal, Textarea } from '../components/UI';
import { api } from '../lib/api';
import { FormFeedback, useFormFeedback } from '../components/FormFeedback';
import { ImagePicker, savedImages, uploadSelectedImages, type SelectedImage } from '../components/ImagePicker';
import type { Room, RoomStatus } from '../types';
import { validateListing } from '../../shared/listingValidation.js';
import { cancelledImageSelectionErrors } from '../lib/listingImageFeedback';
import { listingSaveFeedback } from '../lib/listingSaveFeedback';
import { useListingLeaveGuard } from '../lib/useListingLeaveGuard';
import { listingReturn } from '../lib/roomNavigation';
import './ListingFormPage.css';

const listingFields = ['title', 'description', 'price', 'capacity', 'ownerIsResident', 'googleMapsUrl', 'priceBasis', 'locality', 'costNotes', 'images'];

export function ListingFormPage() {
  const location = useLocation();
  const back = listingReturn(location.state);
  const returnToList = () => navigate(back.to, { state: { focusTarget: back.focusTarget } });
  const { id } = useParams(); const navigate = useNavigate(); const { notify } = useApp(); const [existing, setExisting] = useState<Room | null>(null);
  const [images, setImages] = useState<SelectedImage[]>([]);
  const [checkingImages, setCheckingImages] = useState(false);
  const [ownerIsResident, setOwnerIsResident] = useState(false);
  const [draftCapacity, setDraftCapacity] = useState('2');
  const occupancy = (existing?.memberCount ?? 0) + Number(ownerIsResident);
  const minimumCapacity = Math.max(1, occupancy);
  const [loading, setLoading] = useState(Boolean(id)); const [loadError, setLoadError] = useState(''); const [errors, setErrors] = useState<Record<string, string>>({}); const [saving, setSaving] = useState(false); const [status, setStatus] = useState<RoomStatus>('available');
  const formRef = useRef<HTMLFormElement>(null);
  const { blocker, markSaved, resetBlocker, proceed } = useListingLeaveGuard(formRef, images, JSON.stringify([status, ownerIsResident]), !loading && !loadError, existing);
  const saveBeforeLeave = useRef(false);
  const cancelLeave = () => {
    saveBeforeLeave.current = false;
    resetBlocker();
  };
  const showSaveErrors = () => {
    if (saveBeforeLeave.current) cancelLeave();
    setFocusErrors(true);
  };
  const submitLocked = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [focusErrors, setFocusErrors] = useState(false);
  const summaryRef = useFormFeedback(errors, formRef, focusErrors && blocker.state !== 'blocked');
  const fieldsWithErrors = useRef(new Set<string>());
  const cancelImageSelection = () => {
    if (saving || checkingImages) return;
    fieldsWithErrors.current.add('images');
    setFocusErrors(false);
    // A cancellation must never replace a more useful upload/file error.
    setErrors(current => cancelledImageSelectionErrors(current, images));
  };
  const updateImageFeedback = (next: SelectedImage[]) => {
    const imageErrors = validateListing({ images: next }, { partial: true });
    setErrors(current => {
      const updated = { ...current };
      delete updated.images;
      if (imageErrors.images) updated.images = imageErrors.images;
      return updated;
    });
  };
  const changeImages = (next: SelectedImage[]) => {
    setFocusErrors(false);
    if (next.length < images.length || fieldsWithErrors.current.has('images')) {
      fieldsWithErrors.current.add('images');
      updateImageFeedback(next);
    }
    setImages(next);
  };
  const validateField = (event: FocusEvent<HTMLFormElement> | FormEvent<HTMLFormElement>, onlyPreviouslyInvalid = false) => {
    const field = event.target;
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) || !listingFields.includes(field.name)) return;
    const name = field.name;
    if (onlyPreviouslyInvalid && !fieldsWithErrors.current.has(name)) return;
    const fieldErrors = validateListing({ [name]: field instanceof HTMLInputElement && field.type === 'checkbox' ? field.checked : field.value }, { partial: true, minimumCapacity });
    if (fieldErrors[name]) fieldsWithErrors.current.add(name);
    // Field feedback must not move focus while typing or moving to the next field.
    setFocusErrors(false);
    setErrors(current => {
      const next = { ...current };
      delete next[name];
      if (fieldErrors[name]) next[name] = fieldErrors[name];
      return next;
    });
  };
  useEffect(() => { if (!id) return; let active = true; api.room(id).then(room => { if (!active) return; if (!room.isOwner) { setLoadError('คุณแก้ไขได้เฉพาะประกาศของตัวเอง'); return; } setExisting(room); setOwnerIsResident(room.ownerIsResident !== false); setDraftCapacity(String(room.capacity)); setImages(savedImages(room.images.map(image => image.imageUrl))); setStatus(room.status === 'inactive' ? 'inactive' : 'available'); }).catch(caught => active && setLoadError(caught instanceof Error ? caught.message : 'โหลดประกาศไม่สำเร็จ')).finally(() => active && setLoading(false)); return () => { active = false; }; }, [id]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitLocked.current || checkingImages) return;
    // Lock synchronously: React state and disabled controls update after this handler.
    submitLocked.current = true;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const nextErrors = validateListing({ ...values, ownerIsResident, images }, { minimumCapacity });
    Object.keys(nextErrors).forEach(field => fieldsWithErrors.current.add(field));
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) { showSaveErrors(); submitLocked.current = false; return; }
    setFocusErrors(false);
    const originalStatus = existing?.status === 'inactive' ? 'inactive' : 'available';
    const payload = {
      title: String(values.title).trim(), description: String(values.description || '').trim(),
      googleMapsUrl: String(values.googleMapsUrl).trim(), price: Number(values.price), capacity: Number(values.capacity),
      priceBasis: String(values.priceBasis || ''), locality: String(values.locality || '').trim(),
      costNotes: String(values.costNotes || '').trim(), ownerIsResident,
      ...(!existing || status !== originalStatus ? { status } : {}),
    };
    setSaving(true);
    let stage = 'upload';
    try {
      let uploadedImages = images;
      const imageUrls = await uploadSelectedImages(images, uploaded => {
        uploadedImages = uploadedImages.map(image => image.id === uploaded.id ? uploaded : image);
        setImages(uploadedImages);
        updateImageFeedback(uploadedImages);
      });
      if (!mounted.current) return;
      const uploadedErrors = validateListing({ images: imageUrls }, { partial: true });
      if (uploadedErrors.images) { showSaveErrors(); setErrors(uploadedErrors); submitLocked.current = false; setSaving(false); return; }
      stage = 'save';
      if (existing) await api.updateRoom(existing.roomId, { ...payload, images: imageUrls });
      else await api.createRoom({ ...payload, images: imageUrls });
      // A session change may unmount this form while a request is in flight.
      if (!mounted.current) return;
      notify(existing ? 'บันทึกการแก้ไขแล้ว' : 'สร้างประกาศแล้ว');
      // Keep the lock through navigation so a successful save cannot be repeated.
      if (saveBeforeLeave.current) proceed();
      else { markSaved(); returnToList(); }
    } catch (caught) {
      const fields = listingSaveFeedback(caught, stage === 'upload' ? 'upload' : 'save', listingFields);
      showSaveErrors();
      Object.keys(fields).forEach(field => fieldsWithErrors.current.add(field));
      setErrors(fields);
      submitLocked.current = false;
      setSaving(false);
    }
  };
  if (loading) return <div className="page"><Skeleton variant="listing-form"/></div>;
  if (loadError) return <div className="page form-error-page"><h1>เปิดประกาศไม่ได้</h1><p>{loadError}</p><Button onClick={() => returnToList()}>{back.label}</Button></div>;
  return <div className="page listing-form-page"><button className="back-link" disabled={saving} onClick={() => returnToList()}><ArrowLeft size={18}/>{back.label}</button><header className="form-page-header"><div><h1>{existing ? 'แก้ไขประกาศ' : 'ลงประกาศห้อง'}</h1><p>ข้อมูลทั้งหมดจะบันทึกใน RoomMatch และแสดงให้ผู้ค้นหาห้องเห็น</p></div></header>
    <form ref={formRef} className="listing-form" onSubmit={submit} onBlur={event => validateField(event)} onChange={event => validateField(event, true)} noValidate aria-busy={saving}><fieldset className="image-upload-fields" disabled={saving}><section className="form-section"><header><span>1</span><div><h2>ข้อมูลห้อง</h2><p>ตั้งชื่อสั้น ๆ และเล่ารายละเอียดที่ช่วยตัดสินใจ</p></div></header><div className="form-section-body"><Input label="หัวข้อประกาศ *" name="title" maxLength={200} defaultValue={existing?.title} error={errors.title} required/><Textarea label="รายละเอียดห้อง" name="description" maxLength={5000} rows={6} defaultValue={existing?.description} error={errors.description}/><div className="form-grid"><Input label="ราคา / เดือน *" name="price" type="number" min={1} step={1} placeholder="เช่น 3500" defaultValue={existing?.price} error={errors.price} required/><label className="field"><span className="field-label">หน่วยราคา <span className="required-marker" aria-hidden="true">*</span></span><select name="priceBasis" required defaultValue={existing?.priceBasis || ''} aria-invalid={Boolean(errors.priceBasis)} aria-describedby={errors.priceBasis ? "price-basis-error" : undefined}><option value="">เลือกหน่วยราคา</option><option value="per_room">ทั้งห้อง / เดือน</option><option value="per_person">ต่อคน / เดือน</option></select>{errors.priceBasis && <span id="price-basis-error" className="field-error">{errors.priceBasis}</span>}</label></div><Input label="จำนวนผู้พัก *" name="capacity" type="number" min={minimumCapacity} max={100} value={draftCapacity} onChange={event => setDraftCapacity(event.target.value)} error={errors.capacity} hint="จำนวนคนสูงสุดที่ห้องรองรับได้ เช่น 2 หมายถึงพักได้ทั้งหมด 2 คน" required/><label className="owner-residence-option"><input type="checkbox" name="ownerIsResident" checked={ownerIsResident} onChange={event => { const checked = event.target.checked; setOwnerIsResident(checked); const capacityErrors = validateListing({ capacity: draftCapacity }, { partial: true, minimumCapacity: Math.max(1, (existing?.memberCount ?? 0) + Number(checked)) }); setErrors(current => { const next = { ...current }; delete next.capacity; if (capacityErrors.capacity) next.capacity = capacityErrors.capacity; return next; }); }}/><span><strong>ฉันพักอยู่ในห้องนี้ด้วย</strong><small>นับฉันเป็นผู้พัก 1 คน หากลงประกาศเพื่อปล่อยเช่าอย่างเดียวไม่ต้องเลือก</small></span></label><Textarea label="ค่าใช้จ่ายที่รวมและไม่รวม" name="costNotes" maxLength={1000} rows={3} defaultValue={existing?.costNotes} error={errors.costNotes} placeholder="ระบุค่าน้ำ ค่าไฟ เงินประกัน หรือค่าแรกเข้าที่ทราบ หากยังไม่ทราบเว้นว่างได้"/><div className="form-tip"><UsersRound size={18}/><span>เมื่อบันทึกจะมีผู้พัก {occupancy} คน · {Number.isInteger(Number(draftCapacity)) && Number(draftCapacity) >= minimumCapacity ? `รับเพิ่มได้ ${Number(draftCapacity) - occupancy} คน` : 'กรุณาตรวจสอบจำนวนผู้พัก'}<br/>คำขอที่รอพิจารณายังไม่นับเป็นผู้พัก</span></div></div></section>
      <section className="form-section"><header><span>2</span><div><h2>ตำแหน่งและสถานะ</h2><p>เพิ่มลิงก์แผนที่โดยไม่จำเป็นต้องเปิดเผยเลขห้อง</p></div></header><div className="form-section-body"><Input label="ย่านหรือถนน *" name="locality" required maxLength={200} defaultValue={existing?.locality} error={errors.locality} hint="ระบุทำเลโดยย่อ ไม่จำเป็นต้องเปิดเผยเลขห้อง"/><Input label="Google Maps URL *" name="googleMapsUrl" type="url" maxLength={2048} defaultValue={existing?.googleMapsUrl} error={errors.googleMapsUrl} required/><div className="form-tip"><MapPin size={18}/><span>ใช้ลิงก์แชร์จาก Google Maps เพื่อให้เปิดตำแหน่งได้จริง</span></div><div className="field"><span className="field-label" id="listing-status-label">สถานะประกาศ</span><div className="status-choice" role="group" aria-labelledby="listing-status-label"><button type="button" aria-pressed={status === 'available'} className={status === 'available' ? 'selected' : ''} onClick={() => setStatus('available')}>เปิดรับคำขอ</button><button type="button" aria-pressed={status === 'inactive'} className={status === 'inactive' ? 'selected' : ''} onClick={() => setStatus('inactive')}>พักประกาศ</button></div></div></div></section>
      <section className="form-section"><header><span>3</span><div><h2>รูปภาพห้อง</h2><p>เลือกรูปจากเครื่องได้สูงสุด 12 รูป แล้วจัดลำดับรูปปกได้เลย</p></div></header><div className="form-section-body"><ImagePicker label="รูปภาพห้อง" images={images} onCheckingChange={setCheckingImages} onSelectionCancel={cancelImageSelection} onChange={changeImages} fieldName="images" required max={12} disabled={saving} error={errors.images}/></div></section>
      <footer className="listing-form-actions"><FormFeedback errors={errors.form ? { form: errors.form } : {}} summaryRef={summaryRef}/><div className="form-action-buttons"><Button type="button" variant="quiet" onClick={() => returnToList()}>ยกเลิก</Button><Button type="submit" disabled={saving || checkingImages} loading={saving}>{saving ? (images.some(image => image.file) ? 'กำลังอัปโหลดรูป…' : 'กำลังบันทึก…') : existing ? 'บันทึกการแก้ไข' : 'สร้างประกาศ'}</Button></div></footer>
    </fieldset></form>
    {blocker.state === 'blocked' && <Modal className="form-leave-modal" title="ยังไม่ได้บันทึกประกาศ" onClose={cancelLeave} actions={<>
      <Button type="button" variant="secondary" disabled={saving} onClick={proceed}>ยกเลิกการแก้ไข</Button>
      <Button type="button" disabled={checkingImages} loading={saving} onClick={() => {
        if (submitLocked.current || checkingImages || !formRef.current) return;
        saveBeforeLeave.current = true;
        formRef.current.requestSubmit();
      }}>บันทึกและไปต่อ</Button>
    </>}>
      <p>คุณมีข้อมูลประกาศที่ยังไม่ได้บันทึก ต้องการยกเลิกการแก้ไข หรือบันทึกก่อนไปหน้าที่เลือก?</p>
      <p>ปิดหน้าต่างนี้เพื่อกลับไปแก้ไขต่อ</p>
      {(saving || checkingImages) && <p role="status">{checkingImages ? 'กำลังตรวจไฟล์ภาพ…' : 'กำลังบันทึกข้อมูล กรุณารอสักครู่…'}</p>}
    </Modal>}
  </div>;
}
