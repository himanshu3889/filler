from django.urls import path
from . import views

urlpatterns = [
    path('fileUpload', views.file_upload, name='file_upload'),
    path('agent/message', views.agent_message, name='agent_message'),
    path('updatePlaceholders', views.update_placeholders, name='update_placeholders'),
]

