const http = require('http');
const crypto = require('crypto');
const { exec } = require('child_process');

const { getEventByData } = require('./events.js');
let config;

try {
  config = require('./config.json');
} catch (err) {
  if (err.code === 'ENOENT') {
    console.error('Please create `./config.json`');
    return;
  }
  console.log(err);
  console.error('Unexpected error. Usually this should not happen. Report this!');
}

const { host, port, hooks } = config;

http.createServer((req, res) => {
  let data = '';
  req.on('data', chunk => data += chunk);
  req.on('end', async () => await processRequest(req, data, callback));
  function callback(success) {
    res.writeHead(success ? 200 : 500);
    res.end();
  }
}).listen(port, host, () => {
  console.log(`Webhook has been planted.\nhttp://${host}:${port}`);
});

async function processRequest(req, data, callback) {
  let repoHooks = getHooksForEvent(data);
  if (!repoHooks.length) {
    return callback(true); // Nothing to do.
  }
  let results = [];
  for (const { cmd, secret } of repoHooks) {
    if (!cmd) {
      console.error('No command to execute');
      return;
    }
    if (checkSecret(req, data, secret)) {
      results[results.length] = await executeCommand(cmd);
    }
  }
  callback(results.length && results.every(result => result === true));
}

function getHooksForEvent(data) {
  try {
    data = JSON.parse(data);
    let event = getEventByData(data);
    if (!event) {
      console.error('No event!');
      return;
    }
    let repository = data.repository?.full_name;
    if (!repository) {
      console.error('No repo!');
      return;
    }
    let [user, repo] = repository.split('/');
    let repoHooks = hooks.filter(hook => {
      let sameRepoAndEvent = hook.user === user
        && hook.repo === repo
        && hook.event === event;
      let sameBranch = data.ref
          ? (hook.branch || "master") === data.ref.replace('refs/heads/', '')
          : true;
      return sameRepoAndEvent && sameBranch;
    });
    if (!repoHooks.length) {
      console.log(`No hooks for event ${event} of ${repository}`);
    }
    return repoHooks;
  } catch (e) {
    console.error('No parsable payload');
    return [];
  }
}

function checkSecret(req, data, secret) {
  if (!secret && !req.headers['x-hub-signature']) {
    return true; // Nothing to do.
  }
  if (secret && req.headers['x-hub-signature']) {
    let sig = "sha1=" + crypto.createHmac('sha1', secret).update(data.toString()).digest('hex');
    return req.headers['x-hub-signature'] === sig;
  }
  if (!secret && req.headers['x-hub-signature']) {
    console.error('Secret is not set');
    return false;
  }
  console.error('Header "x-hub-signature" is not set');
  return false;
}

async function executeCommand(cmd) {
  return new Promise((resolve) => {
    let datetime = new Date().toLocaleString();
    console.log(`[${datetime}] Executing ${cmd}...`);

    exec(cmd, (error, stdout, stderr) => {
      let datetime = new Date().toLocaleString();
      if (error) {
        console.log(`[${datetime}] Failed to execute command:`);
        console.error(`error: ${error}`);
        return resolve(false);
      }
      console.log(`[${datetime}] Success.`);
      return resolve(true);
    });
  })
}
