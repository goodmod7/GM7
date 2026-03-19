'use client';

import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { Loader2 } from 'lucide-react';

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

export function Button({
  children,
  className,
  loading = false,
  variant = 'primary',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  className?: string;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}) {
  return (
    <button className={cx('button', `button--${variant}`, className)} disabled={loading || props.disabled} {...props}>
      {loading ? <Loader2 className="spinner" size={16} /> : null}
      {children}
    </button>
  );
}

export function Card({
  children,
  className,
  subtle = false,
  hover = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  className?: string;
  subtle?: boolean;
  hover?: boolean;
}) {
  return (
    <div className={cx('card', subtle && 'card--subtle', hover && 'card--hover', className)} {...props}>
      {children}
    </div>
  );
}

export function Badge({
  children,
  tone = 'info',
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode;
  tone?: 'info' | 'success' | 'warning' | 'danger';
}) {
  return (
    <span className={cx('badge', tone !== 'info' && `badge--${tone}`, className)} {...props}>
      {children}
    </span>
  );
}

export function FieldLabel({ children, className, ...props }: LabelHTMLAttributes<HTMLLabelElement> & { children: ReactNode }) {
  return (
    <label className={cx('field-label', className)} {...props}>
      {children}
    </label>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx('input', props.className)} {...props} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx('textarea', props.className)} {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx('select', props.className)} {...props} />;
}

export function Banner({
  children,
  tone = 'warning',
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  tone?: 'success' | 'warning' | 'danger';
}) {
  return (
    <div className={cx('banner', `banner--${tone}`, className)} {...props}>
      {children}
    </div>
  );
}
