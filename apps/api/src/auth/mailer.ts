// Moved to @paras/shared so the worker can send email too.
export {
  ConsoleMailer,
  MemoryMailer,
  ResendMailer,
  createMailer,
  type Email,
  type Mailer,
} from '@paras/shared';
