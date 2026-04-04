const mongoose = require('mongoose');

const MONGODB_URI = 'mongodb+srv://abhishekakg13_db_user:qDz7YFsoECIKxPFZ@cluster0.h4w6anx.mongodb.net/SaveMyLink';
const LOKESH_ID = '69d1085ca83068e1c4267072';

async function migrate() {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');
    
    const result = await mongoose.connection.collection('links').updateMany({}, { $set: { userId: new mongoose.Types.ObjectId(LOKESH_ID) } });
    console.log(`Migration complete. Modified ${result.modifiedCount} links for Lokesh.`);
    
    await mongoose.disconnect();
}

migrate().catch(console.error);
