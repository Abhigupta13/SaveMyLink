// Shared auth validation — same rules run on the client (instant feedback) and server (trust boundary)
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export const PASSWORD_RULES = [
  { label: 'At least 8 characters', test: (p: string) => p.length >= 8 },
  { label: 'One uppercase letter', test: (p: string) => /[A-Z]/.test(p) },
  { label: 'One number', test: (p: string) => /\d/.test(p) },
  { label: 'One special character', test: (p: string) => /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(p) },
];

export const validateName = (v: string) =>
  !v.trim() ? 'Please enter your name' : v.trim().length < 2 ? 'Name is too short' : '';

export const validateEmail = (v: string) =>
  !v.trim() ? 'Please enter your email' : !EMAIL_RE.test(v.trim()) ? 'That doesn’t look like a valid email' : '';

export const validatePassword = (v: string) => {
  if (!v) return 'Please enter a password';
  const failed = PASSWORD_RULES.filter(r => !r.test(v));
  return failed.length ? `Password needs: ${failed.map(f => f.label.toLowerCase()).join(', ')}` : '';
};
