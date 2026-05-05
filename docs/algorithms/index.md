# 算法

嵌入式常用算法与数据处理，侧重嵌入式平台上的 C 语言实现。

---

## 目录

### [数字滤波 (IIR / FIR)](./digital-filters/)
一阶/二阶 IIR 设计、FIR 窗函数法、定点数实现技巧

### [卡尔曼滤波](./kalman/)
线性卡尔曼理论基础、一维/多维实现、计算复杂度优化

### [PID 控制算法](./pid/)
标准/增量式 PID、参数整定 (Ziegler-Nichols)、抗积分饱和、微分先行

### [传感器融合](./sensor-fusion/)
互补滤波、Mahony 姿态解算、EKF 九轴融合

### [信号处理 (FFT)](./signal-processing/)
CMSIS-DSP FFT 使用、窗函数选择、频谱泄漏抑制

### [运动控制算法](./motion-control/)
梯形/S 曲线加减速、电子齿轮、轨迹规划

### [CRC 与纠错码](./crc/)
CRC8/16/32 查表法实现、模2除法、Hamming 码简介
