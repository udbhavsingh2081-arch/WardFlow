const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const isLoggedIn = require('../middleware/isLoggedIn');

router.get('/login', authController.showLogin);
router.post('/login', authController.login);
router.get('/register', authController.showRegister);
router.post('/register', authController.register);
router.get('/logout', isLoggedIn, authController.logout);
router.get('/profile', isLoggedIn, authController.showProfile);
router.post('/profile', isLoggedIn, authController.updateProfile);

module.exports = router;
