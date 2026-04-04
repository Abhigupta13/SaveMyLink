'use server'

import connectToDatabase from '@/lib/mongodb';
import { User } from '@/lib/models/User';
import bcrypt from 'bcryptjs';

export async function registerUser(formData: any) {
  const { name, email, password } = formData;

  // Validation
  if (!email || !email.includes('@')) {
    return { error: 'Invalid email address' };
  }

  // Password validation: 8+ chars, 1 number, 1 special char, 1 caps
  const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/;
  if (!passwordRegex.test(password)) {
    return { error: 'Password must be at least 8 characters long, contain 1 uppercase letter, 1 number, and 1 special character.' };
  }

  await connectToDatabase();

  try {
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return { error: 'User already exists' };
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    await User.create({
      name,
      email: email.toLowerCase(),
      password: hashedPassword
    });

    return { success: true };
  } catch (err: any) {
    return { error: err.message || 'Something went wrong' };
  }
}

export async function forgotPassword(email: string) {
    await connectToDatabase();
    try {
        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) {
            return { error: 'No user found with this email' };
        }
        
        // In a real app, you would generate a token and send an email here.
        // For now, we'll just simulate it.
        return { success: true, message: 'If an account exists for this email, you will receive a reset link shortly.' };
    } catch (err: any) {
        return { error: err.message };
    }
}
