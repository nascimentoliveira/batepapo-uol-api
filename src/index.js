//imports
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import joi from 'joi';
import dayjs from 'dayjs';
import { MongoClient } from 'mongodb';
import { stripHtml } from 'string-strip-html';

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
const MESSAGES_LIMIT = 100;
const PERSISTENCE_TIME_MS = 10000;
const UPDATE_TIME_MS = 15000;
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

setInterval(async () => {
  const participantsOff = await participants.find({
    lastStatus: { $lte: Date.now() - PERSISTENCE_TIME_MS }
  }).toArray();

  if (participantsOff.length > 0) {
    await participants.deleteMany({ name: { $in: participantsOff.map(participant => participant.name) } });
    await messages.insertMany(participantsOff.map(participant => (
      {
        from: participant.name,
        to: 'Todos',
        text: 'sai da sala...',
        type: 'status',
        time: dayjs().format('HH:mm:ss')
      }
    )));
  }

  /* console.log('The participant list has been updated at', dayjs().format('HH:mm:ss')); */
}, UPDATE_TIME_MS);

/* Participants Route */
app.post('/participants', async (req, res) => {
  const user = req.body;

  Object.keys(user).forEach(key => {
    user[key] = stripHtml(user[key]).result.trim();
  });

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
  const user = req.headers.user;
  const message = req.body;

  Object.keys(message).forEach(key => {
    message[key] = stripHtml(message[key]).result.trim();
  });

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

app.get('/messages', async (req, res) => {
  const user = req.headers.user;
  const limit = Number(req.query.limit);

  if (!user) {
    return res.status(422).send({ message: 'Unexpected header format. Field "user" expected.' });
  }

  try {
    const messagesUser = await messages.find({
      $or: [
        { from: user },
        { to: { $in: [user, 'Todos'] } },
        { type: 'message' }
      ]
    }).sort({ $natural: 1 }).limit(limit || MESSAGES_LIMIT).toArray();
    res.status(200).send(messagesUser);

  } catch (err) {
    console.error('An error has occurred:', err);
    res.status(500).send({ message: 'An error has occurred', error: err });
  }
});

app.delete('/messages/:messageID', async (req, res) => {
  const user = req.headers.user;
  const messageID = Number(req.params.messageID)

  if (!user)
    return res.status(422).send({ message: 'Unexpected header format. Field "user" expected.' });

  if (!messageID)
    return res.status(422).send({ message: 'Message ID required.' });

  try {
    const message = await messages.findOne({ _id: ObjectId(messageID) });

    if (!message)
      return res.status(404).send({ message: 'Message not found.' });

    if (message.from !== user.name || message.type === 'status')
      return res.status(401).send({ message: 'Operation not allowed.' });

    await messages.deleteOne({ _id: ObjectId(messageID) });
    res.status(200).send({ message: 'Message deleted successfully.' });

  } catch (err) {
    console.error('An error has occurred:', err);
    res.status(500).send({ message: 'An error has occurred', error: err });
  }
});

app.put('/messages/:messageID', async (req, res) => {
  const user = req.headers.user;
  const messageID = Number(req.params.messageID)
  const newMessage = req.body;

  if (!user)
    return res.status(422).send({ message: 'Unexpected header format. Field "user" expected.' });

  if (!messageID)
    return res.status(422).send({ message: 'Message ID required.' });

  Object.keys(newMessage).forEach(key => {
    newMessage[key] = stripHtml(newMessage[key]).result.trim();
  });

  const validation = messageSchema.validate(newMessage, { abortEarly: false });

  if (validation.error) {
    const errors = validation.error.details.map((detail) => detail.message);
    return res.status(422).send({ message: 'Unexpected format', errors: errors });
  }

  try {
    const message = await messages.findOne({ _id: ObjectId(messageID) });

    if (!message)
      return res.status(404).send({ message: 'Message not found.' });

    if (message.from !== user.name || message.type === 'status')
      return res.status(401).send({ message: 'Operation not allowed.' });

    await usersColection.updateOne({
      id: user._id
    }, {
      $set: {
        from: user,
        ...newMessage,
        time: dayjs().format('HH:mm:ss')
      }
    })

    res.status(200).send({ message: 'Message updated successfully.' });

  } catch (err) {
    console.error('An error has occurred:', err);
    res.status(500).send({ message: 'An error has occurred', error: err });
  }
});

/* Status Route */
app.post('/status', async (req, res) => {
  const user = req.headers.user;

  if (!user) {
    return res.status(422).send({ message: 'Unexpected header format. Field "user" expected.' });
  }

  try {
    const userExists = await participants.findOne({ name: user });

    if (!userExists)
      return res.status(404).send({ message: 'User not found' });

    await participants.updateOne({ _id: userExists._id }, { $set: { lastStatus: Date.now() } });

    res.status(200).send({ message: 'Updated status' });

  } catch (err) {
    console.error('An error has occurred:', err);
    res.status(500).send({ message: 'An error has occurred', error: err });
  }
});

/* Server listen */
app.listen(PORT, function (err) {
  if (err) console.log('Failed to start the server -', err);
  console.log('Server listening on port', PORT);
});