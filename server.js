const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bodyParser = require('body-parser');

const app = express();
const port = process.env.PORT || 3000;
const dataFilePath = path.join(__dirname, 'contact-submissions.json');
const csvFilePath = path.join(__dirname, 'contact-submissions.csv');
const ADMIN_PASSWORD = process.env.ADMIN_PASS || 'admin123';
const validTokens = new Set();

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname)));

function getTokenFromReq(req) {
  const cookie = req.headers.cookie || '';
  const parts = cookie.split(';').map(c => c.trim());
  const match = parts.find(p => p.startsWith('admin_token='));
  return match ? match.split('=')[1] : null;
}

function isAuth(req) {
  const token = getTokenFromReq(req);
  return token && validTokens.has(token);
}

app.get('/admin', (req, res) => {
  if (isAuth(req)) {
    return res.sendFile(path.join(__dirname, 'admin.html'));
  }

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Admin Login</title>
  <style>body{font-family:Arial,Helvetica,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f7fafc} .card{background:#fff;padding:2rem;border-radius:0.75rem;box-shadow:0 10px 30px rgba(2,6,23,0.08);width:320px;text-align:center} input{width:100%;padding:0.6rem;margin-top:0.5rem;border-radius:0.5rem;border:1px solid #e2e8f0} button{margin-top:1rem;padding:0.6rem 1rem;border-radius:0.5rem;border:none;background:#0b63f2;color:#fff;font-weight:700;cursor:pointer}</style>
</head>
<body>
  <div class="card">
    <h2>Admin Login</h2>
    <form method="post" action="/admin/login">
      <input type="password" name="password" placeholder="Password" required />
      <button type="submit">Sign in</button>
    </form>
  </div>
</body>
</html>`);
});

app.post('/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (password === ADMIN_PASSWORD) {
    const token = crypto.randomBytes(16).toString('hex');
    validTokens.add(token);
    res.cookie('admin_token', token, { httpOnly: true });
    return res.redirect('/admin');
  }
  return res.status(401).send('<h1>Unauthorized</h1><p>Invalid password.</p>');
});

app.get('/admin/data', (req, res) => {
  if (!isAuth(req)) return res.status(401).json({ error: 'unauthorized' });
  let submissions = [];
  try {
    if (fs.existsSync(dataFilePath)) {
      const fileData = fs.readFileSync(dataFilePath, 'utf8');
      submissions = JSON.parse(fileData || '[]');
    }
  } catch (err) {
    console.error('Error reading submissions for admin:', err);
  }
  res.json({ submissions });
});

app.post('/admin/delete-all', (req, res) => {
  if (!isAuth(req)) return res.status(401).send('unauthorized');
  try {
    fs.writeFileSync(dataFilePath, JSON.stringify([], null, 2), 'utf8');
    if (fs.existsSync(csvFilePath)) fs.unlinkSync(csvFilePath);
    return res.json({ ok: true });
  } catch (err) {
    console.error('Error clearing submissions:', err);
    return res.status(500).json({ ok: false });
  }
});

app.post('/submit', (req, res) => {
  const { name, phone, email, message, captcha } = req.body;
  const submission = {
    name: name ? name.trim() : '',
    phone: phone ? phone.trim() : '',
    email: email ? email.trim() : '',
    message: message ? message.trim() : '',
    submittedAt: new Date().toISOString()
  };

  if (!submission.name || !submission.phone || !submission.email || !submission.message || !captcha) {
    return res.status(400).send('<h1>Submission failed</h1><p>Please fill in all fields.</p>');
  }

  if (captcha.trim() !== '7') {
    return res.status(400).send('<h1>Submission failed</h1><p>Captcha answer is incorrect.</p>');
  }

  let submissions = [];
  if (fs.existsSync(dataFilePath)) {
    try {
      const fileData = fs.readFileSync(dataFilePath, 'utf8');
      submissions = JSON.parse(fileData);
    } catch (error) {
      console.error('Error reading submissions file:', error);
    }
  }

  submissions.push(submission);
  try {
    fs.writeFileSync(dataFilePath, JSON.stringify(submissions, null, 2));
  } catch (error) {
    console.error('Error writing submissions file:', error);
    return res.status(500).send('<h1>Server error</h1><p>Could not save your message.</p>');
  }

  const escapeCsvValue = (value) => {
    if (typeof value !== 'string') return '';
    return `"${value.replace(/"/g, '""')}"`;
  };

  const csvRow = [
    escapeCsvValue(submission.name),
    escapeCsvValue(submission.phone),
    escapeCsvValue(submission.email),
    escapeCsvValue(submission.message),
    escapeCsvValue(submission.submittedAt)
  ].join(',') + '\n';

  try {
    if (!fs.existsSync(csvFilePath)) {
      const header = 'Name,Phone,Email,Message,Submitted At\n';
      fs.writeFileSync(csvFilePath, header + csvRow, 'utf8');
    } else {
      fs.appendFileSync(csvFilePath, csvRow, 'utf8');
    }
  } catch (error) {
    console.error('Error writing CSV file:', error);
  }

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Thank You</title>
  <style>body{font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8fafc;color:#111827;} .card{background:#fff;padding:2rem;border-radius:1rem;box-shadow:0 20px 50px rgba(15,23,42,0.12);max-width:500px;text-align:center;} a{display:inline-block;margin-top:1.5rem;padding:0.85rem 1.5rem;background:#0b63f2;color:#fff;border-radius:999px;text-decoration:none;}</style>
</head>
<body>
  <div class="card">
    <h1>Thank you!</h1>
    <p>Your message has been sent successfully. We will contact you soon.</p>
    <a href="/index.html">Return to website</a>
    <a href="/download-csv" style="margin-left:1rem;">Download CSV</a>
  </div>
</body>
</html>`);
});

app.get('/download-csv', (req, res) => {
  if (!isAuth(req)) {
    return res.status(403).send('<h1>Forbidden</h1><p>Please sign in at <a href="/admin">/admin</a> to download.</p>');
  }
  if (!fs.existsSync(csvFilePath)) {
    return res.status(404).send('<h1>No CSV found</h1><p>Please submit data first.</p>');
  }
  res.download(csvFilePath, 'contact-submissions.csv');
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
