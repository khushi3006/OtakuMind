import React, { useEffect } from 'react';
import { CheckCircle, Info, AlertTriangle } from 'lucide-react';

export type ToastType = 'success' | 'info' | 'warning';

export interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
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
  const defaultDuration =
    message.type === 'success' ? 2200 :
    message.type === 'info' ? 3000 :
    4000;

  useEffect(() => {
    const timer = setTimeout(() => {
      onRemove(message.id);
    }, message.duration ?? defaultDuration);
    return () => clearTimeout(timer);
  }, [defaultDuration, message.duration, message.id, onRemove]);

  const Icon = message.type === 'success' ? CheckCircle : message.type === 'warning' ? AlertTriangle : Info;

  return (
    <div className="toast" onClick={() => onRemove(message.id)}>
      <Icon className="toast-icon" size={20} />
      <span>{message.message}</span>
    </div>
  );
};

export default Toast;
