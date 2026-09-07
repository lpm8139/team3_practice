import { NextResponse } from 'next/server'

export type ErrorCode =
  | 'INVALID_REQUEST'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'EXPIRED'
  | 'TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export function errorResponse(error: ApiError | unknown): NextResponse {
  const apiError = error instanceof ApiError
    ? error
    : new ApiError(500, 'INTERNAL_ERROR', 'An internal error occurred.')
  return NextResponse.json(
    { error: { code: apiError.code, message: apiError.message } },
    { status: apiError.status, headers: { 'Cache-Control': 'no-store' } },
  )
}

export function asApiError(error: unknown): ApiError {
  return error instanceof ApiError
    ? error
    : new ApiError(500, 'INTERNAL_ERROR', 'An internal error occurred.')
}
