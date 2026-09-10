import { useState } from 'react';

interface PasswordFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  minLength?: number;
  required?: boolean;
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
  label,
  value,
  onChange,
  autoComplete,
  minLength,
  required,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <label>
      {label}
      <div className="password-field">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          minLength={minLength}
          required={required}
        />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
    </label>
  );
}
