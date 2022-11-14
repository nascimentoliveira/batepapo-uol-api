//imports
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import joi from 'joi';
import dayjs from 'dayjs';
import { MongoClient, ObjectId } from 'mongodb';
import { stripHtml } from 'string-strip-html';

dotenv.config();

const userSchema = joi.object({
  name: joi.string().min(1).required()
});

const messageSchema = joi.object({
  to: joi.string().min(1).required(),
  text: joi.string().min(1).required(),
  type: joi.string().valid('message', 'private_message').required()
});

const PORT = 5000;
const MESSAGES_LIMIT = 100;
const PERSISTENCE_TIME_MS = 10000;
const UPDATE_TIME_MS = 15000;
const MESSAGE_ERROR = 'An error has occurred';
const DATABASE_NAME = 'bate-papo_UOL';
let db, participantsCollection, messagesCollection;

// config express
const app = express();
app.use(cors());
app.use(express.json());

/* Database connection */
const mongoClient = new MongoClient(process.env.MONGO_URI);

console.log('Trying to connect to the data server...');
await mongoClient.connect()
  .then(() => {
    db = mongoClient.db(DATABASE_NAME);
    participantsCollection = db.collection('participants');
    messagesCollection = db.collection('messages');
    console.log('Connection to data server established!');
  })
  .catch(err => {
    return console.log('Failed to connect to database:', err);
  });

setInterval(async () => {
  const participantsOff = await participantsCollection.find({
    lastStatus: { $lte: Date.now() - PERSISTENCE_TIME_MS }
  }).toArray();

  if (participantsOff.length > 0) {
    await participantsCollection.deleteMany({
      name: { $in: participantsOff.map(participant => participant.name) }
    });

    await messagesCollection.insertMany(
      participantsOff.map(participant => ({
        from: participant.name,
        to: 'Todos',
        text: 'sai da sala...',
        type: 'status',
        time: dayjs().format('HH:mm:ss')
      }))
    );
  }
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
    return res.status(422).send({ message: 'Unexpected format!', errors: errors });
  }

  try {
    const userExists = await participantsCollection.findOne({ name: user.name });

    if (userExists)
      return res.status(409).send({ message: 'User already exists!' });

    await participantsCollection.insertOne({
      name: user.name,
      lastStatus: Date.now()
    });

    await messagesCollection.insertOne({
      from: user.name,
      to: 'Todos',
      text: 'entra na sala...',
      type: 'status',
      time: dayjs().format('HH:mm:ss')
    });

    res.status(201).send({ message: 'User created successfully!' });

  } catch (err) {
    console.error(MESSAGE_ERROR, err);
    res.status(500).send({ message: MESSAGE_ERROR, error: err });
  }
});

app.get('/participants', async (req, res) => {
  try {
    const participants = await participantsCollection.find().toArray();
    res.status(200).send(participants);

  } catch (err) {
    console.error(MESSAGE_ERROR, err);
    res.status(500).send({ message: MESSAGE_ERROR, error: err });
  }
});

/* Messages Route */
app.post('/messages', async (req, res) => {
  const user = req.headers.user;
  const message = req.body;

  Object.keys(message).forEach(key => {
    message[key] = stripHtml(message[key]).result.trim();
  });

  if (!user)
    return res.status(400).send({ message: 'Unexpected header format! Field "User" expected.' });

  const validation = messageSchema.validate(message, { abortEarly: false });

  if (validation.error) {
    const errors = validation.error.details.map((detail) => detail.message);
    return res.status(422).send({ message: 'Unexpected format', errors: errors });
  }

  try {
    const userFromExists = await participantsCollection.findOne({ name: user });

    if (!userFromExists)
      return res.status(401).send({ message: 'Message sender not found!' });

    const userToExists = await participantsCollection.findOne({ name: message.to });

    if (!userToExists && message.to !== 'Todos')
      return res.status(400).send({ message: 'Message receiver not found!' });

    await messagesCollection.insertOne({
      from: user,
      ...message,
      time: dayjs().format('HH:mm:ss')
    });

    res.status(201).send({ message: 'Message registered successfully' });

  } catch (err) {
    console.error(MESSAGE_ERROR, err);
    res.status(500).send({ message: MESSAGE_ERROR, error: err });
  }
});

app.get('/messages', async (req, res) => {
  const user = req.headers.user;
  const limit = Number(req.query.limit);

  if (!user) 
    return res.status(400).send({ message: 'Unexpected header format! Field "User" expected.' });

  try {
    const userAuthenticated = await participantsCollection.findOne({ name: user });

    if (!userAuthenticated)
      return res.status(401).send({ message: 'User unauthenticated!' });

    const messages = await messagesCollection.find({
      $or: [
        { from: user },
        { to: { $in: [user, 'Todos'] } },
        { type: 'message' }
      ]
    }).sort({ $natural: -1 }).limit(limit || MESSAGES_LIMIT).toArray();
    res.status(200).send(messages.reverse());

  } catch (err) {
    console.error(MESSAGE_ERROR, err);
    res.status(500).send({ message: MESSAGE_ERROR, error: err });
  }
});

app.delete('/messages/:messageID', async (req, res) => {
  const user = req.headers.user;
  const messageID = req.params.messageID;

  if (!user)
    return res.status(400).send({ message: 'Unexpected header format! Field "User" expected.' });

  if (!messageID)
    return res.status(400).send({ message: 'Message ID required!' });

  try {
    const message = await messagesCollection.findOne({ _id: new ObjectId(messageID) });

    if (!message)
      return res.status(404).send({ message: 'Message not found!' });

    if (message.from !== user || message.type === 'status')
      return res.status(401).send({ message: 'Operation not allowed!' });

    await messagesCollection.deleteOne({ _id: message._id });
    res.status(200).send({ message: 'Message deleted successfully!' });

  } catch (err) {
    console.error(MESSAGE_ERROR, err);
    res.status(500).send({ message: MESSAGE_ERROR, error: err });
  }
});

app.put('/messages/:messageID', async (req, res) => {
  const user = req.headers.user;
  const messageID = req.params.messageID;
  const newMessage = req.body;

  if (!user)
    return res.status(400).send({ message: 'Unexpected header format! Field "User" expected.' });

  if (!messageID)
    return res.status(400).send({ message: 'Message ID required!' });

  Object.keys(newMessage).forEach(key => {
    newMessage[key] = stripHtml(newMessage[key]).result.trim();
  });

  const validation = messageSchema.validate(newMessage, { abortEarly: false });

  if (validation.error) {
    const errors = validation.error.details.map((detail) => detail.message);
    return res.status(422).send({ message: 'Unexpected format!', errors: errors });
  }

  try {
    const message = await messagesCollection.findOne({ _id: new ObjectId(messageID) });

    if (!message)
      return res.status(404).send({ message: 'Message not found!' });

    if (message.from !== user || message.type === 'status')
      return res.status(401).send({ message: 'Operation not allowed!' });

    await messagesCollection.updateOne({ _id: message._id }, { $set: { text: newMessage.text } });

    res.status(200).send({ message: 'Message updated successfully!' });

  } catch (err) {
    console.error(MESSAGE_ERROR, err);
    res.status(500).send({ message: MESSAGE_ERROR, error: err });
  }
});

/* Status Route */
app.post('/status', async (req, res) => {
  const user = req.headers.user;

  if (!user) {
    return res.status(400).send({ message: 'Unexpected header format! Field "User" expected.' });
  }

  try {
    const userAuthenticated = await participantsCollection.findOne({ name: user });

    if (!userAuthenticated)
      return res.status(404).send({ message: 'UUser unauthenticated!' });

    await participantsCollection.updateOne({
      _id: userAuthenticated._id
    }, {
      $set: { lastStatus: Date.now() }
    });

    res.status(200).send({ message: 'Updated status!' });

  } catch (err) {
    console.error(MESSAGE_ERROR, err);
    res.status(500).send({ message: MESSAGE_ERROR, error: err });
  }
});

/* Server listen */
app.listen(PORT, function (err) {
  if (err) console.log('Failed to start the server -', err);
  console.log('APP Server listening on port', PORT);
});