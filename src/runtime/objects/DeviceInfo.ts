export class DeviceInfo {
  getBatteryLevelPercentage(): number {
    return 85;
  }

  getMobileNetworkSignalStrength(): number {
    return 75;
  }

  isPhone(): boolean {
    return true;
  }

  isTablet(): boolean {
    return false;
  }

  getDeviceType(): string {
    return 'phone';
  }

  getOsName(): string {
    return 'iOS';
  }

  getOsVersion(): string {
    return '17.0';
  }

  getDeviceId(): string {
    return 'SIM-DEVICE-ID';
  }

  getModel(): string {
    return 'iPhone Simulator';
  }

  getManufacturer(): string {
    return 'Apple';
  }
}
