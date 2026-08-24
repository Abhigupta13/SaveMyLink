'use server'

import connectToDatabase from '@/lib/mongodb';
import { User, type IUser } from '@/lib/models/User';
import bcrypt from 'bcryptjs';
import { validateName, validateEmail, validatePassword } from '@/lib/validation';
import { Project } from '@/lib/models/Project';
import { sendMail, otpEmail, welcomeEmail, mailConfigured } from '@/lib/mailer';
import { newOtp, hashOtp, otpExpiry, checkOtp, isSixDigits, attemptsLeftMessage } from '@/lib/otp';
import { appUrl } from '@/lib/url';

/** Issues a fresh code onto whichever pair of fields the caller owns, and returns the plaintext. */
async function issueOtp(user: IUser, kind: 'reset' | 'verify') {
  const code = newOtp();
  const token = hashOtp(code);   // only the hash is stored
  const expiry = otpExpiry();
  if (kind === 'verify') { user.verifyToken = token; user.verifyTokenExpiry = expiry; user.verifyAttempts = 0; }
  else { user.resetToken = token; user.resetTokenExpiry = expiry; user.resetAttempts = 0; }
  await user.save();
  return code;
}

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
    const hashedPassword = await bcrypt.hash(password, 12);
    const existingUser = await User.findOne({ email: normalizedEmail });

    if (existingUser?.emailVerified) {
      return { error: 'An account with this email already exists', field: 'email' as const };
    }

    // An unverified row proves nothing about who owns the address — someone may have typed it in
    // and walked away, or typed it deliberately. Whoever can open the inbox wins it, so this
    // signup takes the account over rather than leaving the earlier password able to claim it.
    const user = existingUser
      ? Object.assign(existingUser, { name: name.trim(), password: hashedPassword })
      : new User({ name: name.trim(), email: normalizedEmail, password: hashedPassword });

    const code = await issueOtp(user, 'verify');
    return sendCode(user, code, 'Check your email for the 6-digit code.');
  } catch (err: any) {
    // Unique-index race: two signups with the same email at once
    if (err?.code === 11000) return { error: 'An account with this email already exists', field: 'email' as const };
    console.error('registerUser failed:', err);
    return { error: 'Something went wrong. Please try again.' };
  }
}

/**
 * SMTP being unconfigured must not block a local signup, so the code comes back on screen the
 * same way the reset flow already does. Never reached in production, where mail is configured.
 */
async function sendCode(user: IUser, code: string, message: string) {
  const { subject, html, text } = otpEmail(code, user.name, 'verify');
  const res = await sendMail({ to: user.email, subject, html, text })
    .catch(error => { console.error('Verification email failed:', user.email, error); return { delivered: false as const }; });
  if (!res.delivered) {
    console.warn('[verify] code for', user.email, '=', code);
    return { success: true as const, needsVerification: true as const, message: 'Email is not configured — your code is below (dev only):', code };
  }
  return { success: true as const, needsVerification: true as const, message };
}

export async function forgotPassword(email: string) {
  const emailError = validateEmail(email || '');
  if (emailError) return { error: emailError };

  await connectToDatabase();
  // Same answer whether or not the account exists — no account discovery
  const generic = { success: true as const, message: 'If that email is registered, a 6-digit code is on its way.' };

  try {
    const user = await User.findOne({ email: email.trim().toLowerCase() });
    if (!user) return generic;

    const code = await issueOtp(user, 'reset');

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
  if (!isSixDigits(code)) return { error: 'Enter the 6-digit code from your email', field: 'code' as const };
  const passwordError = validatePassword(password || '');
  if (passwordError) return { error: passwordError, field: 'password' as const };

  await connectToDatabase();
  try {
    const user = await User.findOne({ email: email.trim().toLowerCase() });
    if (!user) return { error: 'That code has expired. Request a new one.', field: 'code' as const };

    switch (checkOtp({ token: user.resetToken, expiry: user.resetTokenExpiry, attempts: user.resetAttempts }, code)) {
      case 'expired':
        return { error: 'That code has expired. Request a new one.', field: 'code' as const };
      case 'locked':
        user.resetToken = undefined; user.resetTokenExpiry = undefined; await user.save();
        return { error: 'Too many wrong attempts. Request a new code.', field: 'code' as const };
      case 'wrong':
        user.resetAttempts = (user.resetAttempts || 0) + 1;
        await user.save();
        return { error: attemptsLeftMessage(user.resetAttempts), field: 'code' as const };
    }

    user.password = await bcrypt.hash(password, 12);
    user.resetToken = undefined;
    user.resetTokenExpiry = undefined;
    user.resetAttempts = 0;
    // Proving control of the inbox is exactly what verification asks for, so a reset settles it too
    if (!user.emailVerified) user.emailVerified = new Date();
    await user.save();
    return { success: true as const };
  } catch (err: any) {
    console.error('resetPasswordWithOtp failed:', err);
    return { error: 'Could not reset your password. Please try again.' };
  }
}

/**
 * Confirms the address, then decides whether a welcome is warranted. Someone invited to a project
 * already received a personal "X added you to Y" — a generic welcome on top of that is the third
 * email in ninety seconds, and three emails in ninety seconds is what a spam filter is for.
 */
export async function verifyEmail(email: string, code: string) {
  const emailError = validateEmail(email || '');
  if (emailError) return { error: emailError, field: 'email' as const };
  if (!isSixDigits(code)) return { error: 'Enter the 6-digit code from your email', field: 'code' as const };

  await connectToDatabase();
  try {
    const user = await User.findOne({ email: email.trim().toLowerCase() });
    if (!user) return { error: 'That code has expired. Request a new one.', field: 'code' as const };
    if (user.emailVerified) return { success: true as const, alreadyVerified: true as const };

    switch (checkOtp({ token: user.verifyToken, expiry: user.verifyTokenExpiry, attempts: user.verifyAttempts }, code)) {
      case 'expired':
        return { error: 'That code has expired. Request a new one.', field: 'code' as const };
      case 'locked':
        user.verifyToken = undefined; user.verifyTokenExpiry = undefined; await user.save();
        return { error: 'Too many wrong attempts. Request a new code.', field: 'code' as const };
      case 'wrong':
        user.verifyAttempts = (user.verifyAttempts || 0) + 1;
        await user.save();
        return { error: attemptsLeftMessage(user.verifyAttempts), field: 'code' as const };
    }

    user.emailVerified = new Date();
    user.verifyToken = undefined;
    user.verifyTokenExpiry = undefined;
    user.verifyAttempts = 0;
    await user.save();

    const invited = await Project.exists({ memberEmails: user.email });
    if (!invited) {
      const { subject, html, text } = welcomeEmail({ name: user.name, link: appUrl() || 'https://all-you-need.app' });
      // A failed welcome must never undo a successful verification — they are in either way
      await sendMail({ to: user.email, subject, html, text })
        .catch(error => console.error('Welcome email failed:', user.email, error));
    }
    return { success: true as const, welcomed: !invited };
  } catch (err) {
    console.error('verifyEmail failed:', err);
    return { error: 'Could not confirm your email. Please try again.' };
  }
}

/** Same answer whether or not the account exists — signup already leaks that; this need not too. */
export async function resendVerification(email: string) {
  const emailError = validateEmail(email || '');
  if (emailError) return { error: emailError };

  await connectToDatabase();
  const generic = { success: true as const, message: 'If that account needs confirming, a new code is on its way.' };
  try {
    const user = await User.findOne({ email: email.trim().toLowerCase() });
    if (!user || user.emailVerified) return generic;
    const code = await issueOtp(user, 'verify');
    const sent = await sendCode(user, code, 'New code sent.');
    return sent.code ? { ...generic, code: sent.code, message: sent.message } : generic;
  } catch (err) {
    console.error('resendVerification failed:', err);
    return { error: 'Could not send the code. Please try again.' };
  }
}

/** Drives the "confirm your email" banner. Never throws — a banner is not worth an error page. */
export async function verificationStatus(email?: string | null) {
  if (!email) return { verified: true, invited: false };
  try {
    await connectToDatabase();
    const normalized = email.trim().toLowerCase();
    const user = await User.findOne({ email: normalized }).select('emailVerified').lean<{ emailVerified?: Date | null } | null>();
    if (user?.emailVerified) return { verified: true, invited: false };
    // Only worth interrupting someone if there is actually shared work they cannot see yet
    const invited = !!(await Project.exists({ memberEmails: normalized }));
    return { verified: false, invited };
  } catch {
    return { verified: true, invited: false };
  }
}

export async function mailStatus() {
  return { configured: mailConfigured };
}

// Which login providers are configured (so the UI only offers what works)
export async function authProviders() {
  return { google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) };
}
