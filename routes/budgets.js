const express = require('express');
const router = express.Router();
const budgetController = require('../controllers/budgetController');

// GET all budgets
router.get('/', budgetController.getAllBudgets);

// GET single budget by ID
router.get('/:id', budgetController.getBudgetById);

// POST create new budget
router.post('/', budgetController.createBudget);

// PUT update budget
router.put('/:id', budgetController.updateBudget);

// DELETE budget
router.delete('/:id', budgetController.deleteBudget);

module.exports = router;
