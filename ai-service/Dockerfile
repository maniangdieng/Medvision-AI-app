# Pour un futur serveur GPU (NVIDIA + nvidia-container-toolkit).
# En attendant, le service tourne dans Colab : voir MedVision_Serveur_IA_Colab.ipynb
FROM pytorch/pytorch:2.4.0-cuda12.1-cudnn9-runtime
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
