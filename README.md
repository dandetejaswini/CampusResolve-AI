# CampusResolve AI

**AI-powered academic request management and policy resolution platform.**

Developed for the YottaFlex AI Code Challenge.

## Overview
CampusResolve AI simplifies university support operations through intelligent request routing, AI-powered policy assistance, ticket management, and SLA monitoring.

## Key Features
- **AI Policy Assistant:** Provides policy-based answers with source citations.
- **Smart Routing:** Routes requests to the appropriate department.
- **Ticket Management:** Tracks requests from submission to resolution.
- **SLA Monitoring:** Tracks deadlines and escalates overdue requests.
- **Knowledge Base:** Provides searchable, version-controlled policies.
- **Role-Based Access:** Supports learners, instructors, support staff, and administrators.
- **Evaluation:** Includes synthetic datasets and anomaly detection benchmarks.

## User Workflow
Home → Sign In / Sign Up → Dashboard → Create or Track Requests

- Dashboard
- My Requests
- Create Request
- AI Assistant
- Knowledge Base
- Messages and Notifications
- Profile and Settings

## Technology Stack
- **Frontend:** React, TypeScript, Vite, Tailwind CSS
- **Backend:** Node.js, Express, Vercel Serverless Functions
- **Database:** Supabase, PostgreSQL
- **Authentication:** Supabase Auth, Firebase Authentication
- **AI:** Google Gemini, RAG
- **Automation:** Google Apps Script
- **Deployment:** Vercel

## Getting Started

**Prerequisites:** Node.js 20+ and npm 10+.

Clone the repository:

    git clone https://github.com/dandetejaswini/CampusResolve-AI.git
    cd CampusResolve-AI
    npm install

Configure environment variables:

    cp .env.example .env

Add the required Supabase, Firebase, and optional server-side credentials. Apply the SQL migrations from `supabase/migrations/` in Supabase.

Start the application:

    npm run dev

Open http://localhost:3000.

## Useful Commands

    npm test
    npm run lint
    npm run build
    npm run generate:dataset

## Dataset and Evaluation
- 5,000 synthetic tickets.
- 20,000 messages.
- 200 knowledge articles.
- Five anomaly detection scenarios.
- Reproducible dataset generation with a fixed seed.

## Security
- PostgreSQL Row Level Security (RLS).
- Role-based authorization.
- Server-side secret management.
- Restricted access to internal records and evaluation data.

## Documentation

Detailed submission documentation and architecture guides:
- [AI Usage and Prompt History](docs/AI_USAGE_AND_PROMPT_HISTORY.md)
- [Architecture and Design Decisions](docs/ARCHITECTURE_AND_DESIGN_DECISIONS.md)
- [Testing and Evaluation](docs/TESTING_AND_EVALUATION.md)
- [Deployment and Setup Guide](docs/DEPLOYMENT_AND_SETUP_GUIDE.md)
- [Limitations and Future Improvements](docs/LIMITATIONS_AND_FUTURE_IMPROVEMENTS.md)
- [Setup and Architecture Guide](SETUP_AND_ARCHITECTURE.md)
- [Data Dictionary and Schema Definition](DATA_DICTIONARY_AND_ARCHITECTURE.md)
- [Synthetic Datasets](datasets/)

## License
No license has been specified yet.
