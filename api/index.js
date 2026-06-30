import http from 'http';
import app from '../src/app.js';
import mongoose from 'mongoose';
import config from '../src/config/index.js';
import { initializeSocket } from '../src/sockets/index.js';

let isConnected = false;
let ioInitialized = false;

const connectDBForServerless = async () => {
  if (isConnected) return;
  try {
    const conn = await mongoose.connect(config.mongo.uri);
    isConnected = conn.connections[0].readyState === 1;
    console.log(`Serverless: MongoDB connected to ${conn.connection.host}`);
  } catch (error) {
    console.error(`Serverless: MongoDB connection error: ${error.message}`);
  }
};

const ioServer = http.createServer();

export default async function handler(req, res) {
  await connectDBForServerless();

  if (!ioInitialized) {
    initializeSocket(ioServer);
    ioInitialized = true;
  }

  if (req.url.startsWith('/socket.io/')) {
    ioServer.emit('request', req, res);
  } else {
    app(req, res);
  }
}
