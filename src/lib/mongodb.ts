import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI!;

if (!MONGODB_URI) {
  // Rather than crashing entirely at import, only throw when trying to connect
  console.warn('MONGODB_URI is not defined in the environment variables.');
}

/** Survives Next's dev hot-reload, which is the whole reason the connection is cached globally. */
declare global {
  // eslint-disable-next-line no-var
  var mongooseCache: { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null } | undefined;
}

const cached = global.mongooseCache ?? (global.mongooseCache = { conn: null, promise: null });

async function connectToDatabase() {
  if (!MONGODB_URI) {
    throw new Error('Please define the MONGODB_URI environment variable inside .env.local');
  }

  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    const opts = {
      bufferCommands: false,
      /* Fail fast when the network is down rather than hanging the request.
         The driver's default server selection is 30s, and a DNS failure was taking 60s to surface —
         so every action sat there spinning, the UI retried, and it read as an endless retry loop
         with nothing ever being fixed. Eight seconds is far longer than a healthy Atlas round trip
         and short enough that a dropped connection shows up as an error somebody can act on. */
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000,
      socketTimeoutMS: 45000,
    };

    cached.promise = mongoose.connect(MONGODB_URI, opts).then((mongoose) => {
      return mongoose;
    });
  }
  try {
    cached.conn = await cached.promise;
  } catch (err) {
    /* A failed connection promise stays cached forever otherwise: every later request awaits the
       same rejected promise and reports a network error long after the network came back. Clearing
       it means the next request genuinely retries. */
    cached.promise = null;
    throw err;
  }
  return cached.conn;
}

export default connectToDatabase;
