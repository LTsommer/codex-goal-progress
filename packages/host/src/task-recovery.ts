import {
  taskRecoveryPage as sharedTaskRecoveryPage,
  TaskRecoveryError,
} from "../../core/src/task-recovery.js";
import { GoalProgressIpcHandlerError } from "../../ipc/src/index.js";

export const taskRecoveryPage: typeof sharedTaskRecoveryPage = (contract, cursor) => {
  try {
    return sharedTaskRecoveryPage(contract, cursor);
  } catch (error) {
    if (error instanceof TaskRecoveryError) {
      throw new GoalProgressIpcHandlerError(error.code, error.message, error.currentRevision);
    }
    throw error;
  }
};
