import { useState } from 'react';
import { MessageSquareText, Send, ShieldCheck, Star } from 'lucide-react';
import ActionButton from '../components/common/ActionButton.jsx';
import Modal from '../components/common/Modal.jsx';

const RATING_LABELS = ['Poor', 'Fair', 'Good', 'Very good', 'Excellent'];

export default function ReviewModal({ setModal, notify }) {
  const [rating, setRating] = useState(0);
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const defer = async (choice = 'later') => {
    try { await window.pdfStudio?.deferReview?.(choice); }
    catch (deferError) { console.warn('[PDF Studio] Could not persist review preference:', deferError?.message || deferError); }
    setModal(null);
  };

  const submit = async () => {
    if (!rating) { setError('Please choose a star rating first.'); return; }
    setSubmitting(true); setError('');
    try {
      const result = await window.pdfStudio?.submitReview?.({ rating, name: name.trim(), message: message.trim() });
      if (!result?.ok) throw new Error(result?.message || 'Your review could not be saved safely.');
      setModal(null);
      if (result.alreadySubmitted) {
        notify('This installation has already submitted a review. Thank you!', 'success');
      } else if (result.queued) {
        notify('Your review is saved securely on this device and marked as pending. PDF Studio will retry delivery automatically.', 'success');
      } else {
        notify('Thank you for reviewing PDF Studio!', 'success');
      }
    } catch (submitError) {
      setError(String(submitError?.message || 'Your review could not be submitted. Please try again later.'));
    } finally { setSubmitting(false); }
  };

  return (
    <Modal title="How’s PDF Studio working for you?" eyebrow="A QUICK PRODUCT REVIEW" wide onClose={() => defer('later')} footer={
      <>
        <ActionButton onClick={() => defer('later')} disabled={submitting}>Remind me later</ActionButton>
        <ActionButton variant="primary" icon={Send} onClick={submit} loading={submitting} disabled={!rating}>Send review</ActionButton>
      </>
    }>
      <div className="review-modal-intro">
        <div className="review-hero-icon"><MessageSquareText size={24} /></div>
        <div><strong>Your feedback helps improve PDF Studio.</strong><p>This is optional. Share a rating and, if you like, a short note about your experience.</p></div>
      </div>
      <div className="review-rating-block">
        <div className="review-rating-label">How would you rate the app?</div>
        <div className="review-stars" role="group" aria-label="Rating from one to five stars">
          {RATING_LABELS.map((label, index) => {
            const value = index + 1;
            return <button key={label} type="button" className={`review-star-button${rating >= value ? ' is-selected' : ''}`} onClick={() => { setRating(value); setError(''); }} aria-label={`${value} out of 5 stars — ${label}`} aria-pressed={rating === value} disabled={submitting}>
              <Star size={28} fill={rating >= value ? 'currentColor' : 'none'} strokeWidth={1.8} />
            </button>;
          })}
        </div>
        <div className="review-rating-caption">{rating ? `${rating} / 5 · ${RATING_LABELS[rating - 1]}` : 'Select a rating'}</div>
      </div>
      <div className="review-form-grid">
        <label className="form-label">Name <span className="review-optional">Optional</span><input className="form-input" maxLength={60} value={name} onChange={(event) => setName(event.target.value)} placeholder="Anonymous" disabled={submitting} autoComplete="name" /></label>
        <label className="form-label">Your feedback <span className="review-optional">Optional</span><textarea className="form-input review-message" maxLength={1500} rows={4} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="What works well? What could be better?" disabled={submitting} /></label>
      </div>
      <div className="review-privacy-note"><ShieldCheck size={15} /><span>Your review is encrypted in this Windows user profile while pending. Only your rating, optional name and feedback, application version, and installation metadata are sent; PDF documents and their contents are never included.</span></div>
      {error && <div className="review-submit-error" role="alert">{error}</div>}
      <button type="button" className="review-never-button" onClick={() => defer('never')} disabled={submitting}>Don’t ask me again</button>
    </Modal>
  );
}
