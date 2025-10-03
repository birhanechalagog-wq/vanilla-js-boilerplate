const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const app = express();
const port = 3000;

// Connect to the database
const db = new sqlite3.Database('./db.sqlite');

// Create tables if they don't exist
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER UNIQUE,
      username TEXT,
      tokens INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_id INTEGER,
      referred_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (referrer_id) REFERENCES users(id),
      FOREIGN KEY (referred_id) REFERENCES users(id)
    )
  `);
});

app.use(express.static('public'));
app.use(express.json());

// API endpoints
// Register a new user, potentially with a referrer
app.post('/api/register', (req, res) => {
    const { telegram_id, username, referrer_telegram_id } = req.body;

    if (!telegram_id) {
        return res.status(400).json({ error: 'telegram_id is required' });
    }

    // Check if user exists
    db.get('SELECT * FROM users WHERE telegram_id = ?', [telegram_id], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });

        if (user) {
            return res.status(200).json({ message: 'User already exists', user });
        }

        // User does not exist, create them
        db.run('INSERT INTO users (telegram_id, username) VALUES (?, ?)', [telegram_id, username], function(err) {
            if (err) return res.status(500).json({ error: err.message });

            const newUserDbId = this.lastID;

            if (!referrer_telegram_id) {
                return res.status(201).json({ message: 'User registered successfully', userId: newUserDbId });
            }

            // Handle referral
            db.get('SELECT id FROM users WHERE telegram_id = ?', [referrer_telegram_id], (err, referrer) => {
                if (err || !referrer) {
                    console.error('Referrer not found');
                    return res.status(201).json({ message: 'User registered, but referrer not found.', userId: newUserDbId });
                }

                const referrerDbId = referrer.id;
                db.run('INSERT INTO referrals (referrer_id, referred_id) VALUES (?, ?)', [referrerDbId, newUserDbId], (err) => {
                    if (err) {
                        console.error('Failed to create referral', err);
                        return res.status(201).json({ message: 'User registered, but referral creation failed.', userId: newUserDbId });
                    }

                    // Count referrals for referrer
                    db.get('SELECT COUNT(*) as count FROM referrals WHERE referrer_id = ?', [referrerDbId], (err, result) => {
                        if (err) {
                            console.error('Failed to count referrals', err);
                            return res.status(201).json({ message: 'User registered and referral recorded.', userId: newUserDbId });
                        }

                        const newCount = result.count;
                        const milestones = [5, 10, 15, 20];
                        if (milestones.includes(newCount)) {
                            const tokensToAward = 10;
                            db.run('UPDATE users SET tokens = tokens + ? WHERE id = ?', [tokensToAward, referrerDbId], (err) => {
                                if (err) console.error('Failed to award tokens', err);
                                return res.status(201).json({ message: `User registered, referral recorded, and ${tokensToAward} tokens awarded to referrer.`, userId: newUserDbId });
                            });
                        } else {
                            return res.status(201).json({ message: 'User registered and referral recorded.', userId: newUserDbId });
                        }
                    });
                });
            });
        });
    });
});

// Get user data, including referral count and token balance
app.get('/api/user/:telegram_id', (req, res) => {
    const { telegram_id } = req.params;

    db.get('SELECT * FROM users WHERE telegram_id = ?', [telegram_id], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Get referral count
        db.get('SELECT COUNT(*) as count FROM referrals WHERE referrer_id = ?', [user.id], (err, result) => {
            if (err) return res.status(500).json({ error: err.message });

            res.json({
                userId: user.telegram_id,
                username: user.username,
                referrals: result.count,
                tokens: user.tokens,
                invitationLink: `https://t.me/your_app_bot?start=${user.telegram_id}`
            });
        });
    });
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});