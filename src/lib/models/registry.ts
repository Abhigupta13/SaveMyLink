import mongoose, { Model, Schema } from 'mongoose';

/**
 * Mongoose compiles a model once and caches it on `mongoose.models`. Next's dev
 * hot-reload keeps that cache alive across edits, so a changed schema is ignored
 * and any new field is silently stripped on save. In dev we detect that (the
 * reloaded module hands us a fresh Schema object) and recompile.
 */
export function defineModel<T>(name: string, schema: Schema<T>): Model<T> {
  const cached = mongoose.models[name] as Model<T> | undefined;
  if (cached) {
    if (process.env.NODE_ENV === 'production' || cached.schema === schema) return cached;
    delete mongoose.models[name];
    delete (mongoose as any).modelSchemas?.[name];
  }
  return mongoose.model<T>(name, schema);
}
