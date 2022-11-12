//imports
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import joi from 'joi';
import dayjs from 'dayjs';
import { MongoClient } from 'mongodb';

dotenv.config();

const userSchema = joi.object({
  name: joi.string().min(1).required()
});

const messageSchema = joi.object({
  to: joi.string().min(1).required(),
  text: joi.string().min(1).required(),
  type: joi.string().min(1).required()
});

const PORT = 5000;
let db, participants, messages;

// config express
const app = express();
app.use(cors());
app.use(express.json());

/* Database connection */
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

/* Participants Route */
app.post('/participants', async (req, res) => {
  const user = req.body;
  const validation = userSchema.validate(user, { abortEarly: false });

  if (validation.error) {
    const errors = validation.error.details.map((detail) => detail.message);
    return res.status(422).send({ message: 'Unexpected format', errors: errors });
  }

  try {
    const userExists = await participants.findOne({ name: user.name });

    if (userExists)
      return res.status(409).send({ message: 'User already exists' });

    await participants.insertOne({
      name: user.name,
      lastStatus: Date.now()
    });

    await messages.insertOne({
      from: user.name,
      to: 'Todos',
      text: 'entra na sala...',
      type: 'status',
      time: dayjs().format('HH:mm:ss')
    });

    res.status(201).send({ message: 'User created successfully' });

  } catch (err) {
    console.error('An error has occurred:', err);
    res.status(500).send({ message: 'An error has occurred', error: err });
  }
});

app.get('/participants', async (req, res) => {
  try {
    const participantsOn = await participants.find().toArray();
    res.status(200).send(participantsOn);

  } catch (err) {
    console.error('An error has occurred:', err);
    res.status(500).send({ message: 'An error has occurred', error: err });
  }
});

/* Messages Route */
app.post('/messages', async (req, res) => {
  const message = req.body;
  const user = req.headers.user;
  const validation = messageSchema.validate(message, { abortEarly: false });

  if (!user) {
    return res.status(422).send({ message: 'Unexpected header format. Field "user" expected.' });
  }

  try {
    const userFromExists = await participants.findOne({ name: user });

    if (!userFromExists)
      return res.status(422).send({ message: 'User not found' });

    if (validation.error) {
      const errors = validation.error.details.map((detail) => detail.message);
      return res.status(422).send({ message: 'Unexpected format', errors: errors });
    }
  
    const userToExists = await participants.findOne({ name: message.to });

    if (!userToExists && message.to !== 'Todos')
      return res.status(422).send({ message: 'Message receiver not found' });
    
    await messages.insertOne({
      from: user,
      ...message,
      time: dayjs().format('HH:mm:ss')
    });

    res.status(201).send({ message: 'Message registered successfully' });

  } catch (err) {
    console.error('An error has occurred:', err);
    res.status(500).send({ message: 'An error has occurred', error: err });
  }
});

/* Server listen */
app.listen(PORT, function (err) {
  if (err) console.log('Failed to start the server -', err);
  console.log('Server listening on PORT', PORT);
});