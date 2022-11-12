//imports
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

dotenv.config();

const PORT = 5000;
let db, participants, messages;

// config express
const app = express();
app.use(cors());
app.use(express.json());

// database connection
const mongoClient = new MongoClient(process.env.MONGO_URI);

await mongoClient.connect()
  .then(() => {
    db = mongoClient.db('bate-papo_UOL');
    participants = db.collection('participants');
    messages = db.collection('messages');
    console.log('Database connection established');
  })
  .catch(err => {
    return console.log('Failed to connect to database - ', err);
  });

//server listen
app.listen(PORT, function (err) {
  if (err) console.log(err);
  console.log('Server listening on PORT', PORT);
});