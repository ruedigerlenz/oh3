export let debugEnabled = true;

class Logger {
	constructor() {
	}

	formatMessage(type, subsystem, message) {
		const timestamp = new Date().toISOString();
		const typeConfig = logTypes[type] || logTypes.INFO;
		return `[${timestamp}] [${typeConfig.label.padStart(8)}::${subsystem}] ${message}`;
	}

	log(type, subsystem, message, ...args) {
		const formattedMessage = this.formatMessage(type, subsystem, message);
		console.log(formattedMessage, ...args);
	}

	info(subsystem, message, ...args) {
		this.log('info', subsystem, message, ...args);
	}

	warn(subsystem, message, ...args) {
		this.log('warn', subsystem, message, ...args);
	}

	error(subsystem, message, ...args) {
		this.log('error', subsystem, message, ...args);
	}

	success(subsystem, message, ...args) {
		this.log('success', subsystem, message, ...args);
	}

	debug(subsystem, message, ...args) {
		if (debugEnabled) {
			this.log('debug', subsystem, message, ...args);
		}
	}

	createScope(subsystem) {
		return {
			info: (message, ...args) => this.info(subsystem, message, ...args),
			warn: (message, ...args) => this.warn(subsystem, message, ...args),
			error: (message, ...args) => this.error(subsystem, message, ...args),
			success: (message, ...args) => this.success(subsystem, message, ...args),
			debug: (message, ...args) => this.debug(subsystem, message, ...args),
		};
	}

	addType(typeName, config) {
		logTypes[typeName.toUpperCase()] = {
			color: '', // No color
			bgColor: '', // No color
			label: config.label || typeName.toUpperCase(),
		};

		this[typeName.toLowerCase()] = (subsystem, message, ...args) => {
			this.log(typeName.toUpperCase(), subsystem, message, ...args);
		};
	}
}

const logTypes = {
	info: { label: 'info' },
	warn: { label: 'warn' },
	error: { label: 'error' },
	success: { label: 'success' },
	debug: { label: 'debug' }
};

// Create singleton instance
const logger = new Logger();

export default logger;

export const {
	info,
	warn,
	error,
	success,
	debug,
} = logger;