# Budgeto API

Backend API for Budgeto web app - A Node.js Express server that provides RESTful API endpoints for budget management.

## Features

- RESTful API endpoints for budget CRUD operations
- CORS enabled for React Router 7 frontend integration
- In-memory data storage (easily extensible to database)
- Environment-based configuration
- Error handling middleware
- Health check endpoint

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd budgeto_api
```

2. Install dependencies:
```bash
npm install
```

3. Create environment file:
```bash
cp .env.example .env
```

4. Configure your environment variables in `.env` if needed (optional - defaults work out of the box)

## Running the Server

### Development mode (with auto-reload):
```bash
npm run dev
```

### Production mode:
```bash
npm start
```

The server will start on port 3000 by default (or the PORT specified in .env).

## API Endpoints

### Base URL
```
http://localhost:3000
```

### Health Check
```
GET /api/health
```
Returns server status.

### Budget Endpoints

#### Get all budgets
```
GET /api/budgets
```
Returns array of all budgets.

**Response:**
```json
{
  "success": true,
  "count": 2,
  "data": [
    {
      "id": "1",
      "name": "Monthly Budget",
      "amount": 3000,
      "spent": 1500,
      "category": "General",
      "startDate": "2025-11-01",
      "endDate": "2025-11-30",
      "createdAt": "2025-11-12T..."
    }
  ]
}
```

#### Get single budget
```
GET /api/budgets/:id
```
Returns a specific budget by ID.

#### Create new budget
```
POST /api/budgets
Content-Type: application/json

{
  "name": "New Budget",
  "amount": 1000,
  "spent": 0,
  "category": "Entertainment",
  "startDate": "2025-11-01",
  "endDate": "2025-11-30"
}
```

**Required fields:**
- `name` (string)
- `amount` (number)

**Optional fields:**
- `spent` (number, default: 0)
- `category` (string, default: "General")
- `startDate` (string, default: current date)
- `endDate` (string, default: null)

#### Update budget
```
PUT /api/budgets/:id
Content-Type: application/json

{
  "spent": 250
}
```
Updates specified fields of an existing budget.

#### Delete budget
```
DELETE /api/budgets/:id
```
Deletes a budget by ID.

## Project Structure

```
budgeto_api/
├── controllers/
│   └── budgetController.js   # Business logic for budget operations
├── routes/
│   └── budgets.js            # Budget route definitions
├── .env.example              # Environment variables template
├── .gitignore               # Git ignore rules
├── package.json             # Project dependencies and scripts
├── server.js                # Main server file
└── README.md                # This file
```

## CORS Configuration

The API is configured to accept requests from any origin by default. To restrict origins, update the CORS configuration in `server.js` or set `ALLOWED_ORIGINS` in your `.env` file.

## Future Enhancements

- Database integration (MongoDB, PostgreSQL, etc.)
- Authentication and authorization
- Input validation with express-validator
- API rate limiting
- Logging with winston or morgan
- Unit and integration tests
- API documentation with Swagger/OpenAPI

## License

ISC
