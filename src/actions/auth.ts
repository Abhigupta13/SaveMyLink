'use server'

import connectToDatabase from '@/lib/mongodb';
import { User } from '@/lib/models/User';
import bcrypt from 'bcryptjs';
import { validateName, validateEmail, validatePassword } from '@/lib/validation';
import { sendMail, otpEmail, mailConfigured } from '@/lib/mailer';
import { createHash, randomInt } from 'crypto';

interface RegisterInput { name: string; email: string; password: string }


export async function registerUser({ name, email, password }: RegisterInput) {
  // Same rules as the client — never trust the browser's copy
  const nameError = validateName(name || '');
  if (nameError) return { error: nameError, field: 'name' as const };
  const emailError = validateEmail(email || '');
  if (emailError) return { error: emailError, field: 'email' as const };
  const passwordError = validatePassword(password || '');
  if (passwordError) return { error: passwordError, field: 'password' as const };

  await connectToDatabase();

  try {
    const normalizedEmail = email.trim().toLowerCase();
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return { error: 'An account with this email already exists', field: 'email' as const };
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    await User.create({ name: name.trim(), email: normalizedEmail, password: hashedPassword });
    return { success: true };
  } catch (err: any) {
    // Unique-index race: two signups with the same email at once
    if (err?.code === 11000) return { error: 'An account with this email already exists', field: 'email' as const };
    console.error('registerUser failed:', err);
    return { error: 'Something went wrong. Please try again.' };
  }
}

const hashCode = (c: string) => createHash('sha256').update(c).digest('hex');
const MAX_ATTEMPTS = 5;

export async function forgotPassword(email: string) {
  const emailError = validateEmail(email || '');
  if (emailError) return { error: emailError };

  await connectToDatabase();
  // Same answer whether or not the account exists — no account discovery
  const generic = { success: true as const, message: 'If that email is registered, a 6-digit code is on its way.' };

  try {
    const user = await User.findOne({ email: email.trim().toLowerCase() });
    if (!user) return generic;

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    user.resetToken = hashCode(code); // only the hash is stored
    user.resetTokenExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    user.resetAttempts = 0;
    await user.save();

    const { subject, html, text } = otpEmail(code, user.name);
    const res = await sendMail({ to: user.email, subject, html, text });
    if (!res.delivered) {
      console.warn('[forgotPassword] reset code:', code);
      return { success: true as const, message: 'Email is not configured — your code is below (dev only):', code };
    }
    return generic;
  } catch (err: any) {
    console.error('forgotPassword failed:', err);
    return { error: 'Could not send the code. Please try again.' };
  }
}

export async function resetPasswordWithOtp(email: string, code: string, password: string) {
  const emailError = validateEmail(email || '');
  if (emailError) return { error: emailError, field: 'email' as const };
  if (!/^\d{6}$/.test(code || '')) return { error: 'Enter the 6-digit code from your email', field: 'code' as const };
  const passwordError = validatePassword(password || '');
  if (passwordError) return { error: passwordError, field: 'password' as const };

  await connectToDatabase();
  try {
    const user = await User.findOne({ email: email.trim().toLowerCase() });
    if (!user?.resetToken || !user.resetTokenExpiry || user.resetTokenExpiry < new Date()) {
      return { error: 'That code has expired. Request a new one.', field: 'code' as const };
    }
    if ((user.resetAttempts || 0) >= MAX_ATTEMPTS) {
      user.resetToken = undefined; user.resetTokenExpiry = undefined; await user.save();
      return { error: 'Too many wrong attempts. Request a new code.', field: 'code' as const };
    }
    if (user.resetToken !== hashCode(code)) {
      user.resetAttempts = (user.resetAttempts || 0) + 1;
      await user.save();
      const left = MAX_ATTEMPTS - user.resetAttempts;
      return { error: `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.`, field: 'code' as const };
    }

    user.password = await bcrypt.hash(password, 12);
    user.resetToken = undefined;
    user.resetTokenExpiry = undefined;
    user.resetAttempts = 0;
    await user.save();
    return { success: true as const };
  } catch (err: any) {
    console.error('resetPasswordWithOtp failed:', err);
    return { error: 'Could not reset your password. Please try again.' };
  }
}

export async function mailStatus() {
  return { configured: mailConfigured };
}

// Which login providers are configured (so the UI only offers what works)
export async function authProviders() {
  return { google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) };
}
