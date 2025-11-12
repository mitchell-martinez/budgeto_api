// In-memory data storage (replace with database in production)
let budgets = [
  {
    id: '1',
    name: 'Monthly Budget',
    amount: 3000,
    spent: 1500,
    category: 'General',
    startDate: '2025-11-01',
    endDate: '2025-11-30',
    createdAt: new Date().toISOString()
  },
  {
    id: '2',
    name: 'Groceries',
    amount: 500,
    spent: 320,
    category: 'Food',
    startDate: '2025-11-01',
    endDate: '2025-11-30',
    createdAt: new Date().toISOString()
  }
];

// Helper function to generate unique ID
const generateId = () => {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
};

// GET all budgets
exports.getAllBudgets = (req, res) => {
  try {
    res.json({
      success: true,
      count: budgets.length,
      data: budgets
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// GET single budget by ID
exports.getBudgetById = (req, res) => {
  try {
    const budget = budgets.find(b => b.id === req.params.id);
    
    if (!budget) {
      return res.status(404).json({
        success: false,
        error: 'Budget not found'
      });
    }
    
    res.json({
      success: true,
      data: budget
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// POST create new budget
exports.createBudget = (req, res) => {
  try {
    const { name, amount, spent, category, startDate, endDate } = req.body;
    
    // Validation
    if (!name || amount === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Name and amount are required'
      });
    }
    
    const newBudget = {
      id: generateId(),
      name,
      amount: parseFloat(amount),
      spent: spent !== undefined ? parseFloat(spent) : 0,
      category: category || 'General',
      startDate: startDate || new Date().toISOString().split('T')[0],
      endDate: endDate || null,
      createdAt: new Date().toISOString()
    };
    
    budgets.push(newBudget);
    
    res.status(201).json({
      success: true,
      data: newBudget
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// PUT update budget
exports.updateBudget = (req, res) => {
  try {
    const budgetIndex = budgets.findIndex(b => b.id === req.params.id);
    
    if (budgetIndex === -1) {
      return res.status(404).json({
        success: false,
        error: 'Budget not found'
      });
    }
    
    const { name, amount, spent, category, startDate, endDate } = req.body;
    
    // Update only provided fields
    if (name !== undefined) budgets[budgetIndex].name = name;
    if (amount !== undefined) budgets[budgetIndex].amount = parseFloat(amount);
    if (spent !== undefined) budgets[budgetIndex].spent = parseFloat(spent);
    if (category !== undefined) budgets[budgetIndex].category = category;
    if (startDate !== undefined) budgets[budgetIndex].startDate = startDate;
    if (endDate !== undefined) budgets[budgetIndex].endDate = endDate;
    
    budgets[budgetIndex].updatedAt = new Date().toISOString();
    
    res.json({
      success: true,
      data: budgets[budgetIndex]
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// DELETE budget
exports.deleteBudget = (req, res) => {
  try {
    const budgetIndex = budgets.findIndex(b => b.id === req.params.id);
    
    if (budgetIndex === -1) {
      return res.status(404).json({
        success: false,
        error: 'Budget not found'
      });
    }
    
    const deletedBudget = budgets.splice(budgetIndex, 1)[0];
    
    res.json({
      success: true,
      message: 'Budget deleted successfully',
      data: deletedBudget
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};
