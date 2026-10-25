const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticketController');
const isLoggedIn = require('../middleware/isLoggedIn');
const tenantAccess = require('../middleware/tenantAccess');

router.use(isLoggedIn, tenantAccess);

router.get('/', ticketController.listTickets);
router.get('/new', ticketController.showCreate);
router.post('/', ticketController.createTicket);
router.get('/:id', ticketController.showTicket);
router.get('/:id/edit', ticketController.showEdit);
router.post('/:id/assign', ticketController.assignTicket);
router.post('/:id/status', ticketController.updateStatus);
router.post('/:id/comments', ticketController.addComment);
router.post('/:id/resolve', ticketController.resolveTicket);
router.post('/:id/verify', ticketController.verifyTicket);
router.post('/:id/reopen', ticketController.reopenTicket);
router.post('/:id/cancel', ticketController.cancelTicket);
router.post('/:id/ai-summary', ticketController.generateAISummary);

module.exports = router;
