const { MongoClient } = require('mongodb');
require('dotenv').config({ path: '.env.local' });

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    await client.connect();
    const db = client.db();
    
    const links = await db.collection('links').find({}).toArray();
    const categories = await db.collection('categories').find({}).toArray();
    const userList = await db.collection('users').find({}).toArray();
    
    const catMap = Object.fromEntries(categories.map(c => [c._id.toString(), c.name]));
    const userMap = Object.fromEntries(userList.map(u => [u._id.toString(), u.email]));
    
    const csvRows = ['Title,URL,Category,IsPrivate,Tags,UserEmail'];
    
    links.forEach(l => {
      const title = (l.title || '').replace(/"/g, '""');
      const url = l.url;
      const catName = (catMap[l.category?.toString()] || 'Unknown').replace(/"/g, '""');
      const isPrivate = l.isPrivate || false;
      const tags = (l.tags || []).join(';');
      const userEmail = userMap[l.userId?.toString()] || 'Unknown';
      
      csvRows.push(`"${title}","${url}","${catName}",${isPrivate},"${tags}","${userEmail}"`);
    });
    
    const fs = require('fs');
    fs.writeFileSync('all_links_export.csv', csvRows.join('\n'));
    console.log(`Successfully exported ${links.length} links to all_links_export.csv`);
  } catch (err) {
    console.error('Export failed:', err);
  } finally {
    await client.close();
  }
}
run();
