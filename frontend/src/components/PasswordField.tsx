import { useState } from 'react';

interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  minLength?: number;
  required?: boolean;
  autoFocus?: boolean;
  /** Marks the input as the one the current error message is about, so
   *  assistive tech ties the two together and the field can be styled
   *  as invalid. */
  invalid?: boolean;
}

/**
 * A masked password input with a show/hide toggle. Exists because a
 * mistyped, invisible character in a temp password (which mixes case
 * and includes symbols like !@#$%, per credential-generator.ts on the
 * backend) is easy to make and impossible to notice without this —
 * exactly the kind of thing that turns into "my credentials don't
 * work" when they actually do.
 */
export default function PasswordField({
  id,
  label,
  value,
  onChange,
  placeholder,
  autoComplete,
  minLength,
  required,
  autoFocus,
  invalid,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="login-field">
      <label className="login-label" htmlFor={id}>
        {label}
      </label>
      <div className={`login-input${invalid ? ' is-invalid' : ''}`}>
        <svg className="login-input__icon" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <rect x="3" y="8" width="12" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M6 8V5.5a3 3 0 0 1 6 0V8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="9" cy="12.5" r="1" fill="currentColor" />
        </svg>
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          minLength={minLength}
          required={required}
          autoFocus={autoFocus}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? 'auth-error' : undefined}
        />
        <button
          type="button"
          className="login-eye"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
        >
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
              d="M2.5 10s3-6 7.5-6 7.5 6 7.5 6-3 6-7.5 6S2.5 10 2.5 10z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.5" />
            {!visible && (
              <line x1="3" y1="17" x2="17" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            )}
          </svg>
        </button>
      </div>
    </div>
  );
}
