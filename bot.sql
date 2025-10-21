/*M!999999\- enable the sandbox mode */ 
-- MariaDB dump 10.19  Distrib 10.11.14-MariaDB, for debian-linux-gnu (x86_64)
--
-- Host: localhost    Database: bot
-- ------------------------------------------------------
-- Server version	10.11.14-MariaDB-0+deb12u2

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `plans`
--

DROP TABLE IF EXISTS `plans`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `plans` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` text NOT NULL,
  `price` decimal(10,2) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `plans`
--

LOCK TABLES `plans` WRITE;
/*!40000 ALTER TABLE `plans` DISABLE KEYS */;
INSERT INTO `plans` VALUES
(1,'Тест',0.00),
(2,'Основной',100.00);
/*!40000 ALTER TABLE `plans` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `chatId` bigint(20) NOT NULL,
  `phone` varchar(255) DEFAULT NULL,
  `lang` text DEFAULT NULL,
  `name` text DEFAULT NULL,
  `registrationDate` datetime DEFAULT NULL,
  `lastPaymentDate` datetime DEFAULT NULL,
  `paymentAmount` varchar(255) DEFAULT NULL,
  `balance` varchar(255) DEFAULT NULL,
  `lastBillDate` datetime NOT NULL,
  `locked` tinyint(4) NOT NULL DEFAULT 0,
  `lockedDate` datetime NOT NULL,
  `files` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`files`)),
  `plan_id` int(11) DEFAULT NULL,
  `NL` text NOT NULL DEFAULT '\'\\\'0\\\'\'',
  `GE` text NOT NULL DEFAULT '\'\\\'0\\\'\'',
  `admin` int(11) DEFAULT NULL,
  `adminWhoBill` text DEFAULT NULL,
  PRIMARY KEY (`chatId`),
  KEY `plan_id` (`plan_id`),
  CONSTRAINT `users_ibfk_1` FOREIGN KEY (`plan_id`) REFERENCES `plans` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES
(2515644,'','','Kalinin','2024-08-31 04:45:20','2025-09-18 23:14:06','180','347.2688888888918','2025-09-29 20:00:00',0,'2025-08-29 09:00:00',NULL,2,'-1','-5',0,'5906119921'),
(2550885,NULL,'','Натфудлин Рушан','2024-08-14 23:15:33','2025-01-24 18:46:43','50','29.91666666663862','2025-09-29 20:00:00',0,'2025-04-26 19:00:00',NULL,2,'0','0',0,NULL),
(194284464,NULL,NULL,'Kona Kona','2025-02-05 10:19:15','2025-09-16 22:22:10','265','333.4166666666671','2025-09-29 20:00:00',0,'2025-04-26 19:00:00',NULL,2,'vless://f57a440d-9019-4e21-9a34-7d2a9adacef5@vless.rollyk.ru:40443?type=tcp&security=reality&pbk=31SMZTjRqtzab5N2yQa-a0m-RyUHNY8bDkRjKn9okF0&fp=chrome&sni=dl.google.com&sid=7cec4a13b1c76360&spx=%2F&flow=xtls-rprx-vision#NL-194284464-1','vless://b0560bb0-0d84-45a8-a323-a74e6f2e46a0@de-fkf.rollyk.ru:52848?type=tcp&security=reality&pbk=4MNUP5yofQO_mbHcMAIZFW4RpCBX6BqjAgisuSOGwjw&fp=chrome&sni=dl.google.com&sid=89af48&spx=%2F&flow=xtls-rprx-vision#DE-194284464-5',0,'5906119921'),
(342476643,NULL,NULL,'Alik Oss','2025-07-04 12:46:09','2025-07-07 01:45:42','1600','11331.138888889269','2025-09-29 20:00:00',0,'2025-07-04 12:46:09',NULL,2,'vless://14637cb9-0b83-4e84-9ed7-21cd5235bc41@vless.rollyk.ru:40443?type=tcp&security=reality&pbk=31SMZTjRqtzab5N2yQa-a0m-RyUHNY8bDkRjKn9okF0&fp=chrome&sni=dl.google.com&sid=7cec4a13b1c76360&spx=%2F#NL-342476643-1','0',0,'5906119921'),
(398196069,'','','KovachAlexander','2024-10-14 17:33:51','2025-07-05 18:27:52','300','0.1388888888233633','2025-09-01 02:00:00',1,'2025-09-01 03:00:00',NULL,2,'vless://69fb436a-a280-42f5-a0c3-444436ac1b83@vless.rollyk.ru:40443?type=tcp&security=reality&pbk=31SMZTjRqtzab5N2yQa-a0m-RyUHNY8bDkRjKn9okF0&fp=chrome&sni=dl.google.com&sid=7cec4a13b1c76360&spx=%2F#NL-398196069-1','0',0,'5906119921'),
(466898768,NULL,NULL,'Denis','2025-06-26 22:23:30','2025-06-26 22:24:59','300','5.722222222218882','2025-09-29 20:00:00',0,'2025-06-26 22:23:30',NULL,2,'vless://c694036e-abe8-4a30-96b2-f2fb8150e490@vless.rollyk.ru:40443?type=tcp&security=reality&pbk=31SMZTjRqtzab5N2yQa-a0m-RyUHNY8bDkRjKn9okF0&fp=chrome&sni=dl.google.com&sid=7cec4a13b1c76360&spx=%2F&flow=xtls-rprx-vision#NL-466898768-1','0',0,'1014322927'),
(482886304,'+79062446198',NULL,'+79062446198','2025-06-26 22:01:14','2025-06-26 22:06:43','500','427.11111111109847','2025-09-29 20:00:00',0,'2025-06-26 22:01:14',NULL,2,'0','0',0,'5906119921'),
(840635570,NULL,NULL,NULL,'2025-09-15 17:35:46','2025-09-15 17:35:46','10','0.2777777777777747','2025-09-23 07:00:00',1,'2025-09-23 08:00:00',NULL,2,'-1','-5',0,NULL),
(1014322927,'','','Borya','2024-08-12 14:00:00','2025-07-17 19:26:31','200','0.33333333333326','2025-09-29 20:00:00',0,'2025-04-26 19:00:00',NULL,1,'vless://14b11141-76f4-4354-acda-6f248e0c4c40@vless.rollyk.ru:40443?type=tcp&security=reality&pbk=31SMZTjRqtzab5N2yQa-a0m-RyUHNY8bDkRjKn9okF0&fp=chrome&sni=dl.google.com&sid=7cec4a13b1c76360&spx=%2F&flow=xtls-rprx-vision#NL-1014322927-1','vless://588db143-aeab-4fe9-a537-d9872d02f5b2@de-fkf.rollyk.ru:52848?type=tcp&security=reality&pbk=4MNUP5yofQO_mbHcMAIZFW4RpCBX6BqjAgisuSOGwjw&fp=chrome&sni=dl.google.com&sid=89af48&spx=%2F&flow=xtls-rprx-vision#DE-1014322927-5',1,'5906119921'),
(1536975140,NULL,NULL,'Anastasia Lila','2025-01-24 16:06:55','2025-01-26 11:23:17','300','674.7500000000548','2025-09-29 20:00:00',0,'2025-01-24 16:06:55',NULL,2,'0','0',0,NULL),
(5566077511,NULL,NULL,'Andrey Afonin','2024-12-23 10:33:36','2025-07-18 08:04:42','500','637.9722222221561','2025-09-29 20:00:00',0,'2025-01-23 08:00:00',NULL,2,'vless://a7ebeb7f-9fca-408b-8658-242787d5779b@vless.rollyk.ru:40443?type=tcp&security=reality&pbk=31SMZTjRqtzab5N2yQa-a0m-RyUHNY8bDkRjKn9okF0&fp=chrome&sni=dl.google.com&sid=7cec4a13b1c76360&spx=%2F&flow=xtls-rprx-vision-udp443#40443-5566077511-1','0',0,'5906119921'),
(5873003691,NULL,NULL,'Marina','2024-12-29 10:37:04','2025-01-13 15:51:12','1000','506.5555555554487','2025-09-29 20:00:00',0,'2024-12-29 10:37:04',NULL,2,'vless://e6e24296-679b-48d5-96e5-c6123845bcc3@vless.rollyk.ru:40443?type=tcp&security=reality&pbk=31SMZTjRqtzab5N2yQa-a0m-RyUHNY8bDkRjKn9okF0&fp=chrome&sni=dl.google.com&sid=7cec4a13b1c76360&spx=%2F#40443-5873003691-1','0',0,NULL),
(5906119921,NULL,'ru','RLK','2024-11-11 01:39:04','2025-09-24 12:11:50','50','14.555555555434111','2025-09-29 20:00:00',0,'2025-09-24 11:00:00',NULL,2,'-1','-5',1,'5906119921'),
(6001289404,'','','Dima','2024-09-22 19:16:56','2024-12-25 10:06:30','2','169.16666666653958','2025-09-29 20:00:00',0,'2025-04-26 19:00:00',NULL,2,'vless://ae7c249f-4939-4dce-bf08-2fae5c68e65a@vless.rollyk.ru:40443?type=tcp&security=reality&pbk=31SMZTjRqtzab5N2yQa-a0m-RyUHNY8bDkRjKn9okF0&fp=chrome&sni=dl.google.com&sid=7cec4a13b1c76360&spx=%2F#NL-6001289404-1','0',0,NULL),
(6497983961,NULL,NULL,NULL,'2025-09-18 14:27:52','2025-09-20 02:01:20','250','185.27777777777925','2025-09-29 20:00:00',0,'2025-09-20 02:00:00',NULL,2,'-1','-5',0,'5906119921');
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2025-09-29 20:06:38
