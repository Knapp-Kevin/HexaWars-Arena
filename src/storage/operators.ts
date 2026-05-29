import { getDb } from "./db";
import { createOperator as identityCreate, getOperatorByToken as identityAuth } from "../identity/operator";

interface OperatorRow {
  id: number;
  handle: string;
  handle_normalized: string;
  api_key: string;
  created_at: number;
}

export function registerOperator(handle: string): { operator: OperatorRow; apiKey: string } {
  const db = getDb();
  const result = identityCreate(db, handle);
  return {
    operator: {
      id: result.operator.id,
      handle: result.operator.handle,
      handle_normalized: result.operator.handleNormalized,
      api_key: result.token,
      created_at: result.operator.createdAt,
    },
    apiKey: result.token,
  };
}

export const createOperator = registerOperator;

export function authenticateOperator(apiKey: string): OperatorRow | null {
  const db = getDb();
  const op = identityAuth(db, apiKey);
  if (!op) return null;
  return {
    id: op.id,
    handle: op.handle,
    handle_normalized: op.handleNormalized,
    api_key: apiKey,
    created_at: op.createdAt,
  };
}

export const getOperatorByToken = authenticateOperator;
