#!/usr/bin/env node
import { ReplServer } from './repl/ReplServer.js';

const server = new ReplServer();
server.start();
server.whenClosed().then(() => process.exit(0));
