//imports
import express from 'express';
import cors from 'cors';

//constants
const PORT = 5000;

// config express
const app = express();
app.use(cors());
app.use(express.json());

//server listen
app.listen(PORT, function (err) {
  if (err) console.log(err);
  console.log('Server listening on PORT', PORT);
});