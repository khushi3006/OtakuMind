import React, { useEffect, useState } from 'react';
import { CheckCircle, Info, AlertTriangle } from 'lucide-react';

export type ToastType = 'success' | 'info' | 'warning';

export interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastProps {
  messages: ToastMessage[];
  onRemove: (id: string) => void;
}

const Toast: React.FC<ToastProps> = ({ messages, onRemove }) => {
  return (
    <div className="toast-container">
      {messages.map((m) => (
        <ToastItem key={m.id} message={m} onRemove={onRemove} />
      ))}
    </div>
  );
};

const ToastItem: React.FC<{ message: ToastMessage; onRemove: (id: string) => void }> = ({ message, onRemove }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onRemove(message.id);
    }, 4000);
    return () => clearTimeout(timer);
  }, [message.id, onRemove]);

  const Icon = message.type === 'success' ? CheckCircle : message.type === 'warning' ? AlertTriangle : Info;

  return (
    <div className="toast" onClick={() => onRemove(message.id)}>
      <Icon className="toast-icon" size={20} />
      <span>{message.message}</span>
    </div>
  );
};

export default Toast;
