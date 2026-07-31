export class DomainError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message)
    this.name = 'DomainError'
    this.code = code
    this.status = status
    this.details = details
  }
}

export const notFound = (entity = 'Resource') =>
  new DomainError('NOT_FOUND', `${entity} not found`, 404)

export const conflict = (code, message, details) =>
  new DomainError(code, message, 409, details)

export const invalidState = (actual, allowed) =>
  conflict('INVALID_STATE', `Operation is not allowed while workflow is ${actual}`, {
    actual,
    allowed,
  })
