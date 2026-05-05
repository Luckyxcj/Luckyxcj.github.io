# 传感器

常用传感器原理、选型与驱动开发。本章为单页式结构，每种传感器类型一个详情页面。

---

## 目录

### [温湿度传感器](./temp-humidity)
DHT22 / SHT30 / BME280 — 单总线与 I2C 驱动、温湿度补偿算法

### [IMU 惯性测量](./imu)
MPU6050 / ICM20948 / BMI088 — 陀螺仪+加速度计、DMP 姿态解算、零偏校准

### [超声波传感器](./ultrasonic)
HC-SR04 / JSN-SR04T — 回波测距原理、温度补偿、多传感器干扰

### [激光雷达 LiDAR](./lidar)
RPLidar A1 / TFmini / LD19 — 三角测距 vs ToF、ROS 数据格式

### [摄像头与图像传感器](./camera)
OV2640 / OV5640 — DCMI 接口、DMA 采集、JPEG 编码

### [光电与红外传感器](./ir-opto)
TCRT5000 循迹、VL53L0X ToF 测距、红外遥控解码

### [压力传感器](./pressure)
MS5611 / BMP280 / HX711 — I2C 压力传感器、称重传感器桥式电路
