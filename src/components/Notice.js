import React from 'react';

/** A dismissible message box (replaces the browser alert() the original app used). */
export default function Notice({ type = 'info', title, onClose, children }) {
  return (
    <div className={`alert alert-${type} alert-dismissible`} role="alert">
      {title && <strong>{title} </strong>}
      {children}
      {onClose && (
        <button type="button" className="close" aria-label="Close" onClick={onClose}>
          <span aria-hidden="true">&times;</span>
        </button>
      )}
    </div>
  );
}
