# IMU 惯性测量 (MPU6050 / ICM20948)

> **文档说明**：本文档基于 InvenSense/TDK MPU6050、ICM20948 数据手册及姿态解算开源项目 (MahonyAHRS, Madgwick) 整理。

---

## 目录

1. [IMU 基础](#1-imu-基础)
2. [MPU6050 驱动开发](#2-mpu6050-驱动开发)
3. [姿态解算算法](#3-姿态解算算法)
4. [校准与滤波](#4-校准与滤波)
5. [常见问题](#5-常见问题)

---

## 1. IMU 基础

IMU (Inertial Measurement Unit) 包含加速度计和陀螺仪，通常还有温度传感器。

| 传感器 | 测量 | 用途 | 积分得到 |
|--------|------|------|---------|
| 加速度计 | 线性加速度 (含重力) | 测量倾斜角、线性运动 | 速度、位置 (漂移大) |
| 陀螺仪 | 角速度 | 测量旋转速率 | 角度 (漂移随时间累积) |

**为什么需要传感器融合**：加速度计测量角度没有漂移但噪声大；陀螺仪短时精确但随时间漂移。两者互补使用。

---

## 2. MPU6050 驱动开发

### 2.1 I2C 初始化与数据读取

```c
// MPU6050 通过 I2C 读取加速度和角速度
#define MPU6050_ADDR    0x68    // 7-bit 地址 (AD0=0)
#define MPU6050_PWR_MGMT1  0x6B
#define MPU6050_ACCEL_XOUT_H 0x3B
#define MPU6050_GYRO_XOUT_H  0x43

void MPU6050_Init(I2C_HandleTypeDef *hi2c) {
    uint8_t data = 0x00;
    // 1. 唤醒 MPU6050 (PWR_MGMT1 写 0)
    HAL_I2C_Mem_Write(hi2c, MPU6050_ADDR << 1, MPU6050_PWR_MGMT1,
                      I2C_MEMADD_SIZE_8BIT, &data, 1, 100);
}

void MPU6050_ReadAll(I2C_HandleTypeDef *hi2c,
                     int16_t *accel, int16_t *gyro) {
    uint8_t buf[14];
    // 从 ACCEL_XOUT_H 开始连续读 14 字节
    HAL_I2C_Mem_Read(hi2c, MPU6050_ADDR << 1, MPU6050_ACCEL_XOUT_H,
                     I2C_MEMADD_SIZE_8BIT, buf, 14, 100);

    accel[0] = (buf[0] << 8) | buf[1];   // AX
    accel[1] = (buf[2] << 8) | buf[3];   // AY
    accel[2] = (buf[4] << 8) | buf[5];   // AZ
    gyro[0]  = (buf[8] << 8) | buf[9];   // GX
    gyro[1]  = (buf[10] << 8) | buf[11]; // GY
    gyro[2]  = (buf[12] << 8) | buf[13]; // GZ
}

// 转换为物理单位
// 加速度: ±2g 量程 → 16384 LSB/g
float accel_g = accel_raw / 16384.0f;
// 角速度: ±250°/s 量程 → 131 LSB/(°/s)
float gyro_dps = gyro_raw / 131.0f;
```

---

## 3. 姿态解算算法

### 3.1 Mahony 互补滤波器

```c
// Mahony AHRS 算法 (四元数更新)
// 参考: https://github.com/xioTechnologies/Mahony-AHRS
#define Kp 2.0f   // 比例增益 (收敛到加速度计的速度)
#define Ki 0.005f // 积分增益 (补偿陀螺仪偏差)

float q0 = 1.0f, q1 = 0.0f, q2 = 0.0f, q3 = 0.0f;  // 四元数
float integralFBx = 0, integralFBy = 0, integralFBz = 0;

void MahonyAHRSupdate(float gx, float gy, float gz,
                      float ax, float ay, float az,
                      float dt) {
    float recipNorm;
    float halfvx, halfvy, halfvz;
    float halfex, halfey, halfez;

    // 归一化加速度计测量
    if (!((ax == 0) && (ay == 0) && (az == 0))) {
        recipNorm = 1.0f / sqrtf(ax*ax + ay*ay + az*az);
        ax *= recipNorm; ay *= recipNorm; az *= recipNorm;

        // 重力方向在机体坐标系的预期方向
        halfvx = q1*q3 - q0*q2;
        halfvy = q0*q1 + q2*q3;
        halfvz = q0*q0 - 0.5f + q3*q3;

        // 加速度计测量与预估值的叉积 = 误差
        halfex = (ay*halfvz - az*halfvy);
        halfey = (az*halfvx - ax*halfvz);
        halfez = (ax*halfvy - ay*halfvx);

        // PI 调节
        integralFBx += Ki * halfex * dt;
        integralFBy += Ki * halfey * dt;
        integralFBz += Ki * halfez * dt;
        gx += integralFBx + Kp * halfex;
        gy += integralFBy + Kp * halfey;
        gz += integralFBz + Kp * halfez;
    }

    // 四元数积分 (一阶 Runge-Kutta)
    gx *= 0.5f * dt; gy *= 0.5f * dt; gz *= 0.5f * dt;
    q0 += -q1*gx - q2*gy - q3*gz;
    q1 +=  q0*gx + q2*gz - q3*gy;
    q2 +=  q0*gy - q1*gz + q3*gx;
    q3 +=  q0*gz + q1*gy - q2*gx;

    // 四元数归一化
    recipNorm = 1.0f / sqrtf(q0*q0 + q1*q1 + q2*q2 + q3*q3);
    q0 *= recipNorm; q1 *= recipNorm;
    q2 *= recipNorm; q3 *= recipNorm;
}
```

---

## 4. 校准与滤波

```c
// 陀螺仪零偏校准: 静止状态下采集 N 个样本取平均
void Gyro_Calibrate(int16_t *offset, int samples) {
    int32_t sum_x = 0, sum_y = 0, sum_z = 0;
    int16_t accel[3], gyro[3];

    for (int i = 0; i < samples; i++) {
        MPU6050_ReadAll(&hi2c1, accel, gyro);
        sum_x += gyro[0]; sum_y += gyro[1]; sum_z += gyro[2];
        HAL_Delay(5);
    }
    offset[0] = sum_x / samples;
    offset[1] = sum_y / samples;
    offset[2] = sum_z / samples;
}
```

---

## 5. 常见问题

| # | 问题 | 原因 | 解决方法 |
|---|------|------|---------|
| 1 | 姿态角度漂移严重 | 陀螺仪零偏未校准 | 启动时做 2 秒静止校准 |
| 2 | 加速度计噪声大 | 电机/机械振动耦合 | 加低通滤波；用软橡胶减震 |
| 3 | 横滚/俯仰正确但偏航漂移 | 加速度计只能修正 Roll/Pitch, Yaw 依赖陀螺仪积分 | 加磁力计 (9 轴) 修正 Yaw |
| 4 | MPU6050 通信失败 (I2C NACK) | 器件地址错误或 I2C 总线问题 | 确认 AD0 引脚电平；用 I2C 扫描器 |

---

## 6. 参考文档

1. MPU-6000/6050 Datasheet: InvenSense DS-MPU-6000
2. Mahony AHRS: https://github.com/xioTechnologies/Mahony-AHRS
3. "方向余弦矩阵与四元数" — Paul S. Madgwick 论文
