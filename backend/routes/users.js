const express = require('express');
const { authenticateToken, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// Get all users (for backward compatibility)
router.get('/', optionalAuth, async (req, res) => {
  try {
    const db = req.app.locals.db;
    
    const result = await db.query(`
      SELECT id, username, email, full_name as name, created_at
      FROM users
      ORDER BY full_name ASC
    `);

    // Return just the names for backward compatibility with frontend
    const userNames = result.rows.map(user => user.name || user.username);
    
    res.json(userNames);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Get user profile (authenticated)
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    
    const result = await db.query(`
      SELECT id, username, email, full_name, created_at, updated_at
      FROM users
      WHERE id = $1
    `, [req.user.userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    
    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      fullName: user.full_name,
      createdAt: user.created_at,
      updatedAt: user.updated_at
    });
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

// Get all users with details (authenticated)
router.get('/all', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    
    const result = await db.query(`
      SELECT id, username, email, full_name, created_at
      FROM users
      ORDER BY created_at DESC
    `);

    const users = result.rows.map(user => ({
      id: user.id,
      username: user.username,
      email: user.email,
      fullName: user.full_name,
      createdAt: user.created_at
    }));
    
    res.json(users);
  } catch (error) {
    console.error('Error fetching all users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Update user profile (authenticated)
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { fullName, email } = req.body;
    const db = req.app.locals.db;

    // Validate input
    if (!fullName && !email) {
      return res.status(400).json({ error: 'At least one field (fullName or email) is required' });
    }

    // Check if email is already taken by another user
    if (email) {
      const existingUser = await db.query(
        'SELECT id FROM users WHERE email = $1 AND id != $2',
        [email, req.user.userId]
      );

      if (existingUser.rows.length > 0) {
        return res.status(409).json({ error: 'Email already in use' });
      }
    }

    // Build update query dynamically
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (fullName) {
      updates.push(`full_name = $${paramCount}`);
      values.push(fullName);
      paramCount++;
    }

    if (email) {
      updates.push(`email = $${paramCount}`);
      values.push(email);
      paramCount++;
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(req.user.userId);

    const result = await db.query(`
      UPDATE users 
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING id, username, email, full_name, created_at, updated_at
    `, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    
    res.json({
      message: 'Profile updated successfully',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.full_name,
        createdAt: user.created_at,
        updatedAt: user.updated_at
      }
    });
  } catch (error) {
    console.error('Error updating user profile:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

module.exports = router;